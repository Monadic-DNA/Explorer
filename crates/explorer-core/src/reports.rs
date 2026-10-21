use crate::{array, text};
use serde_json::{json, Value};
pub fn rules() -> &'static Value {
    static RULES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    RULES.get_or_init(|| serde_json::from_str(include_str!("../data/report-rules.json")).unwrap())
}
pub fn profile_schema() -> Value {
    serde_json::from_str(include_str!("../data/profile-fields.json")).unwrap()
}
pub fn parse_profile(v: &Value) -> Result<Value, String> {
    let mut profile = json!({});
    for field in array(&profile_schema()) {
        let key = text(field, "key");
        let value = text(v, key).trim();
        profile[key] = match text(field, "type") {
            "list" => json!(value
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()),
            "number" => {
                if value.is_empty() {
                    Value::Null
                } else {
                    let age = value.parse::<u8>().map_err(|_| "Enter a valid age")?;
                    if age > 130 {
                        return Err("Enter an age between 0 and 130".into());
                    }
                    json!(age)
                }
            }
            "select" => {
                if !array(&field["options"])
                    .iter()
                    .any(|o| text(o, "value") == value)
                {
                    return Err(format!("Invalid {}", text(field, "label")));
                }
                json!(value)
            }
            _ => json!(value),
        };
    }
    Ok(profile)
}
pub fn context(v: &Value) -> String {
    let mut parts = Vec::new();
    let join = |key: &str| {
        array(&v[key])
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", ")
    };
    for (key, label) in [
        ("ethnicities", "Ethnicities"),
        ("countriesOfOrigin", "Countries of ancestral origin"),
    ] {
        let s = join(key);
        if !s.is_empty() {
            parts.push(format!("{label}: {s}"));
        }
    }
    if !text(v, "genderAtBirth").is_empty() {
        parts.push(format!(
            "Gender assigned at birth: {}",
            text(v, "genderAtBirth")
        ));
    }
    if let Some(age) = v["age"].as_f64().filter(|n| *n != 0.0) {
        parts.push(format!("Age: {age}"));
    }
    if !text(v, "smokingHistory").is_empty() {
        parts.push(format!(
            "Smoking history: {}",
            match text(v, "smokingHistory") {
                "still-smoking" => "Currently smoking",
                "past-smoker" => "Former smoker",
                _ => "Never smoked",
            }
        ));
    }
    let capitalize = |s: &str| {
        s.chars()
            .next()
            .map(|c| c.to_uppercase().to_string() + &s[c.len_utf8()..])
            .unwrap_or_default()
    };
    if !text(v, "alcoholUse").is_empty() {
        parts.push(format!(
            "Alcohol use: {}",
            capitalize(text(v, "alcoholUse"))
        ));
    }
    let medications = join("medications");
    if !medications.is_empty() {
        parts.push(format!("Current medications/supplements: {medications}"));
    }
    if !text(v, "diet").is_empty() {
        parts.push(format!(
            "Dietary preferences: {}",
            if text(v, "diet") == "regular" {
                "Regular diet (no restrictions)".into()
            } else {
                capitalize(text(v, "diet")) + " diet"
            }
        ));
    }
    for (key, label) in [
        ("personalConditions", "Personal medical history"),
        ("familyConditions", "Family medical history"),
    ] {
        let s = join(key);
        if !s.is_empty() {
            parts.push(format!("{label}: {s}"));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("\n\n{}", parts.join("\n"))
    }
}
pub fn render(v: &Value) -> Result<Value, String> {
    let name = text(v, "name");
    if !["generateMapPrompt", "generateReducePrompt"].contains(&name) {
        return Err("Unknown prompt template".into());
    }
    let mut template = text(rules(), name).to_string();
    let mut values = v["values"].as_object().cloned().unwrap_or_default();
    if values.get("groupSummaries").is_some() {
        let summaries = array(&values["groupSummaries"])
            .iter()
            .enumerate()
            .map(|(i, s)| {
                format!(
                    "--- BATCH {} ANALYSIS ---\n{}",
                    i + 1,
                    s.as_str().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        values.insert("summariesText".into(), json!(summaries));
    }
    for (key, value) in values {
        template = template.replace(
            &format!("{{{key}}}"),
            &value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string()),
        );
    }
    Ok(json!(template))
}
pub fn extract(v: &Value) -> Value {
    let content = v.as_str().unwrap_or("");
    let mut parts = content.splitn(2, "\nCHAT_QUESTIONS:\n");
    let report = parts.next().unwrap_or("").trim_end();
    let questions = parts
        .next()
        .map(|s| {
            s.lines()
                .filter_map(|l| l.strip_prefix("- ").map(str::trim))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({"report":report.trim(),"questions":questions})
}
fn score(r: &Value) -> f64 {
    r["riskScore"].as_f64().unwrap_or(0.0)
}
fn magnitude(r: &Value) -> f64 {
    let s = score(r);
    if text(r, "effectType") == "beta" {
        s.abs()
    } else if s > 0.0 {
        s.ln().abs()
    } else {
        0.0
    }
}
fn credible(r: &Value, low: f64, high: f64) -> bool {
    text(r, "effectType") == "OR" && score(r) > low && score(r) < high
}
pub fn select(v: &Value) -> Value {
    let kind = text(v, "kind").to_lowercase().replace(' ', "");
    let rows = array(&v["results"]);
    let mut selected: Vec<Value> = Vec::new();
    let mut counts = json!({});
    if kind == "toptraits" {
        let mut or = rows
            .iter()
            .filter(|r| credible(r, 0.1, 10.0))
            .cloned()
            .collect::<Vec<_>>();
        let mut beta = rows
            .iter()
            .filter(|r| text(r, "effectType") == "beta" && score(r).abs() < 50.0)
            .cloned()
            .collect::<Vec<_>>();
        or.sort_by(|a, b| magnitude(b).total_cmp(&magnitude(a)));
        beta.sort_by(|a, b| magnitude(b).total_cmp(&magnitude(a)));
        selected.extend(or.iter().take(25).cloned());
        selected.extend(beta.iter().take(25).cloned());
        let remaining = 100 - selected.len();
        selected.extend(or.into_iter().skip(25).take(remaining));
        selected.extend(beta.into_iter().skip(25).take(remaining));
        selected.truncate(100);
    } else if kind == "healthspan" {
        let domains = array(&rules()["domains"]);
        let mut assignments = std::collections::HashMap::new();
        for row in rows.iter().filter(|r| credible(r, 0.1, 10.0)) {
            let trait_name = text(row, "traitName").to_lowercase();
            let mut best = 0;
            let mut domain = "";
            for d in domains {
                let n = array(&d["keywords"])
                    .iter()
                    .filter(|k| trait_name.contains(k.as_str().unwrap_or("")))
                    .count();
                if n > best {
                    best = n;
                    domain = text(d, "id");
                }
            }
            if !domain.is_empty() {
                assignments.insert(row["studyId"].to_string(), domain);
            }
        }
        for domain in domains {
            let id = text(domain, "id");
            let mut matching = rows
                .iter()
                .filter(|r| {
                    credible(r, 0.1, 10.0)
                        && assignments.get(&r["studyId"].to_string()) == Some(&id)
                })
                .cloned()
                .collect::<Vec<_>>();
            matching.sort_by(|a, b| magnitude(b).total_cmp(&magnitude(a)));
            for (level, max, key) in [
                ("increased", 15, "elevated"),
                ("decreased", 8, "protective"),
            ] {
                let part = matching
                    .iter()
                    .filter(|r| text(r, "riskLevel") == level)
                    .take(max)
                    .cloned()
                    .collect::<Vec<_>>();
                counts[id][key] = json!(part.len());
                for mut r in part {
                    r["domain"] = json!(id);
                    selected.push(r);
                }
            }
        }
    } else if kind == "health" {
        let stop="and or the of with in to a an for by at on is it its as my our their has have had past history former previous current recent disease disorder syndrome condition related associated chronic acute primary secondary other type stage generalized loss level levels soft mild moderate severe".split_whitespace().collect::<std::collections::HashSet<_>>();
        for key in ["personalConditions", "familyConditions"] {
            for condition in array(&v["customization"][key]) {
                let label = condition.as_str().unwrap_or("");
                let normalized = label.to_lowercase().replace(
                    |c: char| !c.is_ascii_alphanumeric() && !c.is_whitespace(),
                    " ",
                );
                let words = normalized
                    .split_whitespace()
                    .filter(|w| w.len() > 2 && !stop.contains(w))
                    .collect::<Vec<_>>();
                if words.is_empty() {
                    continue;
                }
                let mut matched = rows
                    .iter()
                    .filter(|r| credible(r, 0.05, 50.0))
                    .map(|r| {
                        (
                            r,
                            words
                                .iter()
                                .filter(|w| text(r, "traitName").to_lowercase().contains(**w))
                                .count(),
                        )
                    })
                    .filter(|(_, n)| *n >= words.len().div_ceil(2))
                    .collect::<Vec<_>>();
                matched.sort_by(|(a, ac), (b, bc)| {
                    bc.cmp(ac)
                        .then_with(|| magnitude(b).total_cmp(&magnitude(a)))
                });
                for (r, _) in matched.into_iter().take(12) {
                    if selected.iter().any(|x| x["studyId"] == r["studyId"]) {
                        continue;
                    }
                    let mut r = r.clone();
                    r["matchedCondition"] = json!(format!(
                        "{}{}",
                        if key == "familyConditions" {
                            "family history: "
                        } else {
                            ""
                        },
                        label
                    ));
                    selected.push(r);
                }
            }
        }
        for (level, max) in [
            ("increased", 30usize.saturating_sub(selected.len().min(30))),
            ("decreased", 20),
        ] {
            let mut matching = rows
                .iter()
                .filter(|r| {
                    credible(r, 0.1, 10.0)
                        && text(r, "riskLevel") == level
                        && !selected.iter().any(|s| s["studyId"] == r["studyId"])
                })
                .cloned()
                .collect::<Vec<_>>();
            matching.sort_by(|a, b| magnitude(b).total_cmp(&magnitude(a)));
            selected.extend(matching.into_iter().take(max));
        }
    } else {
        selected = rows.to_vec();
    }
    json!({"selected":selected,"counts":counts})
}
fn format_report_row(r: &Value, kind: &str) -> String {
    let s = score(r);
    let direction = match text(r, "riskLevel") {
        "increased" => "↑",
        "decreased" => "↓",
        _ => "→",
    };
    let caveat = if kind == "health" && text(r, "effectType") == "OR" {
        if s >= 10.0 {
            " ⚠ unusually large OR; likely rare subtype or specialized cohort"
        } else if s >= 5.0 {
            " ⚠ large OR; interpret with caution"
        } else {
            ""
        }
    } else {
        ""
    };
    let effect = if text(r, "effectType") == "OR" || kind == "healthspan" {
        format!("OR {s:.2}x {direction}{caveat}")
    } else {
        format!("β={}{s:.3} {direction}", if s >= 0.0 { "+" } else { "" })
    };
    let mut row = format!("{} | {effect}", text(r, "traitName"));
    for (key, label) in [
        ("mappedGene", "gene"),
        ("matchedSnp", "snp"),
        ("userGenotype", "genotype"),
    ] {
        if !text(r, key).is_empty() {
            row.push_str(&format!(" | {label}: {}", text(r, key)));
            if key == "userGenotype" && !text(r, "riskAllele").is_empty() {
                row.push_str(&format!(" (risk allele: {})", text(r, "riskAllele")));
            }
        }
    }
    if let Some(p) = crate::risk::float(text(r, "pValueMlog")) {
        row.push_str(if p >= 10.0 {
            " | p: very strong"
        } else if p >= 7.3 {
            " | p: strong"
        } else if p >= 5.0 {
            " | p: moderate"
        } else {
            " | p: suggestive"
        });
    }
    if kind == "health" && !text(r, "matchedCondition").is_empty() {
        row.push_str(&format!(" [matched: {}]", text(r, "matchedCondition")));
    }
    row
}
fn detailed_prompt(v: &Value, kind: &str) -> String {
    let selected = if v["selected"].is_array() {
        v["selected"].clone()
    } else {
        select(v)["selected"].clone()
    };
    let rows = array(&selected);
    let customization = &v["customization"];
    let history_present = !array(&customization["personalConditions"]).is_empty()
        || !array(&customization["familyConditions"]).is_empty();
    let mut history = Vec::new();
    for key in ["personalConditions", "familyConditions"] {
        for c in array(&customization[key]) {
            let c = c.as_str().unwrap_or("");
            history.push(if kind == "healthspan" {
                format!(
                    "- {}: {c}",
                    if key == "personalConditions" {
                        "Personal"
                    } else {
                        "Family"
                    }
                )
            } else {
                format!(
                    "{c}{}",
                    if key == "familyConditions" {
                        " (family history)"
                    } else {
                        ""
                    }
                )
            });
        }
    }
    let mut sections = Vec::new();
    if kind == "healthspan" {
        for domain in array(&rules()["domains"]) {
            let matching = rows
                .iter()
                .filter(|r| text(r, "domain") == text(domain, "id"))
                .collect::<Vec<_>>();
            if matching.len() < 2 {
                continue;
            }
            let mut parts = Vec::new();
            for (level, label) in [("increased", "Elevated"), ("decreased", "Protective")] {
                let part = matching
                    .iter()
                    .filter(|r| text(r, "riskLevel") == level)
                    .map(|r| format_report_row(r, kind))
                    .collect::<Vec<_>>();
                if !part.is_empty() {
                    parts.push(format!("{label} ({}):\n{}", part.len(), part.join("\n")));
                }
            }
            sections.push(format!(
                "## {}\n{}",
                text(domain, "label").to_uppercase(),
                parts.join("\n")
            ));
        }
    } else {
        let labels = if kind == "health" {
            vec![
                ("matched", "RESULTS MATCHED TO HEALTH HISTORY"),
                ("increased", "STRONGEST ADDITIONAL ELEVATED SIGNALS"),
                ("decreased", "STRONGEST PROTECTIVE SIGNALS"),
            ]
        } else {
            vec![
                ("increased", "ELEVATED SIGNALS"),
                ("decreased", "PROTECTIVE SIGNALS"),
            ]
        };
        for (level, label) in labels {
            let part = rows
                .iter()
                .filter(|r| {
                    if level == "matched" {
                        !text(r, "matchedCondition").is_empty()
                    } else {
                        (kind != "health" || text(r, "matchedCondition").is_empty())
                            && text(r, "riskLevel") == level
                    }
                })
                .map(|r| format_report_row(r, kind))
                .collect::<Vec<_>>();
            if !part.is_empty() {
                sections.push(format!("{label} ({}):\n{}", part.len(), part.join("\n")));
            }
        }
    }
    let prefix = if kind == "toptraits" {
        "topTraits"
    } else {
        kind
    };
    let mut template = text(rules(), &format!("{prefix}Template")).to_string();
    let user_context = context(customization) + text(v, "context");
    let history = if history.is_empty() {
        String::new()
    } else {
        format!("\nHEALTH HISTORY:\n{}\n", history.join("\n"))
    };
    for (key, value) in [
        ("userCtx", user_context),
        ("conditionSection", history.clone()),
        ("healthHistorySection", history),
        ("sections", sections.join("\n\n")),
        ("domainSections", sections.join("\n\n")),
        (
            "instruction",
            text(
                rules(),
                if history_present {
                    "healthinstructionWithHistory"
                } else {
                    "healthinstructionWithoutHistory"
                },
            )
            .into(),
        ),
        (
            "healthHistoryNote",
            text(
                rules(),
                if history_present {
                    "healthspanhealthHistoryNoteWithHistory"
                } else {
                    "healthspanhealthHistoryNoteWithoutHistory"
                },
            )
            .into(),
        ),
        (
            "historyLine",
            text(
                rules(),
                if history_present {
                    "healthspanHistoryLine"
                } else {
                    "healthspanNoHistoryLine"
                },
            )
            .into(),
        ),
    ] {
        template = template.replace(&format!("{{{key}}}"), &value);
    }
    template
}
pub fn statistics(rows: &[Value]) -> Value {
    let count = |level: &str| {
        rows.iter()
            .filter(|r| text(r, "riskLevel") == level)
            .count()
    };
    let percent = |n: usize| {
        if rows.is_empty() {
            "0.0".into()
        } else {
            format!("{:.1}", n as f64 / rows.len() as f64 * 100.0)
        }
    };
    let top = |level: &str, descending: bool| {
        let mut r = rows
            .iter()
            .filter(|r| text(r, "riskLevel") == level)
            .collect::<Vec<_>>();
        r.sort_by(|a, b| {
            let order = a["riskScore"]
                .as_f64()
                .unwrap_or(1.0)
                .total_cmp(&b["riskScore"].as_f64().unwrap_or(1.0));
            if descending {
                order.reverse()
            } else {
                order
            }
        });
        r.into_iter()
            .take(5)
            .map(|r| json!({"traitName":r["traitName"],"riskScore":r["riskScore"]}))
            .collect::<Vec<_>>()
    };
    json!({"totalResults":rows.len(),"increasedRisk":count("increased"),"increasedRiskPercent":percent(count("increased")),"decreasedRisk":count("decreased"),"decreasedRiskPercent":percent(count("decreased")),"neutral":count("neutral"),"neutralPercent":percent(count("neutral")),"topRisks":top("increased",true),"topProtective":top("decreased",false)})
}
pub fn partition(v: &Value) -> Result<Value, String> {
    let n = v["groups"].as_u64().unwrap_or(12) as usize;
    if n == 0 || n > 10000 {
        return Err("Group count must be between 1 and 10000".into());
    }
    let mut rows = array(&v["results"]).to_vec();
    rows.sort_by(|a, b| {
        (b["riskScore"].as_f64().unwrap_or(1.0) - 1.0)
            .abs()
            .total_cmp(&(a["riskScore"].as_f64().unwrap_or(1.0) - 1.0).abs())
    });
    let mut groups = vec![Vec::new(); n];
    for (i, r) in rows.into_iter().enumerate() {
        groups[i % n].push(r)
    }
    Ok(json!(groups))
}
pub fn format_results(rows: &[Value]) -> String {
    rows.iter()
        .map(|r| {
            format!(
                "{}|{}|{}|{}|{}|{}",
                text(r, "traitName").chars().take(60).collect::<String>(),
                r["riskScore"],
                text(r, "riskLevel").chars().next().unwrap_or('n'),
                if text(r, "effectType").is_empty() {
                    "OR"
                } else {
                    text(r, "effectType")
                },
                text(r, "matchedSnp"),
                if text(r, "mappedGene").is_empty() {
                    "Unknown"
                } else {
                    text(r, "mappedGene")
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
pub fn prompt(v: &Value) -> Value {
    let kind = text(v, "kind");
    let rows = array(&v["results"]);
    let context = text(v, "context");
    let normalized = kind.to_lowercase().replace(' ', "");
    let system = rules()["systemPrompts"][&normalized].as_str().unwrap_or("You explain genetic association studies for educational use. Separate relative odds ratios from beta trait changes. Associations are not diagnoses or predictions. Discuss uncertainty, cohort size, ancestry, replication and environmental context. Never prescribe or recommend changing medication. Do not invent studies or citations.");
    let user = if ["health", "healthspan", "toptraits"].contains(&normalized.as_str()) {
        detailed_prompt(v, &normalized)
    } else {
        format!("Create a {kind} report using ONLY the supplied results. State limitations and distinguish risk-increasing, protective and neutral associations. {context}\nFormat: trait|score|direction|effect type|SNP|gene\n{}\nStatistics: {}",format_results(rows),statistics(rows))
    };
    json!({"messages":[{"role":"system","content":system},{"role":"user","content":user}]})
}
