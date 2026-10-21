use crate::{array, reports::rules, risk::float, text};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
fn category(r: &Value) -> (&'static str, &'static str) {
    let s = format!(
        "{} {} {}",
        text(r, "traitName"),
        text(r, "studyTitle"),
        text(r, "mappedGene")
    )
    .to_lowercase();
    for c in array(&rules()["previewCategories"]) {
        if array(&c["keywords"])
            .iter()
            .any(|k| s.contains(k.as_str().unwrap_or("")))
        {
            return (text(c, "id"), text(c, "label"));
        }
    }
    ("other", "other traits")
}
pub fn classify(r: &Value) -> Value {
    let (id, label) = category(r);
    json!({"id":id,"label":label})
}
fn interest(r: &Value) -> f64 {
    let score = r["riskScore"].as_f64().unwrap_or(0.0);
    let effect = if text(r, "effectType") == "beta" {
        (score.abs() * 4.0).min(2.5)
    } else if score <= 0.0 || score > 50.0 {
        0.0
    } else {
        score.ln().abs().min(2.5)
    };
    let mlog = float(&text(r, "pValueMlog").replace(',', "")).unwrap_or(0.0) / 10.0;
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let sample = format!(
        "{} {}",
        text(r, "sampleSize"),
        text(r, "replicationSampleSize")
    );
    let largest = RE
        .get_or_init(|| regex::Regex::new(r"\d[\d,]*").unwrap())
        .find_iter(&sample)
        .filter_map(|m| m.as_str().replace(',', "").parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    let evidence = mlog.min(1.5)
        + if largest >= 100000 {
            1.0
        } else if largest >= 10000 {
            0.6
        } else {
            0.0
        }
        + if !text(r, "replicationSampleSize").is_empty() {
            0.4
        } else {
            0.0
        };
    effect
        + evidence
        + match category(r).0 {
            "other" => 0.0,
            "appearance" => 0.25,
            "cardiometabolic" | "immune" | "medication" => 1.0,
            _ => 0.75,
        }
}
fn normalized(r: &Value) -> String {
    static PARENS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let name = text(r, "traitName").to_lowercase();
    let name = PARENS
        .get_or_init(|| regex::Regex::new(r"\([^)]*\)").unwrap())
        .replace_all(&name, " ");
    let name = name.replace(|c: char| !c.is_ascii_alphanumeric(), " ");
    let stop = [
        "stage",
        "type",
        "disease",
        "disorder",
        "condition",
        "measurement",
        "self",
        "reported",
        "adjusted",
        "male",
        "female",
        "men",
        "women",
    ];
    name.split_whitespace()
        .filter(|w| w.len() > 2 && !stop.contains(w))
        .collect::<Vec<_>>()
        .join(" ")
}
fn priority(r: &Value) -> u8 {
    match category(r).0 {
        "cardiometabolic" => 0,
        "medication" => 1,
        "immune" => 2,
        "sleep_energy" => 3,
        "reproductive" => 4,
        "brain_behavior" => 5,
        "body_composition" => 6,
        "appearance" => 7,
        _ => 8,
    }
}
pub fn select(v: &Value) -> Value {
    let limit = v["limit"].as_u64().unwrap_or(12) as usize;
    if limit == 0 {
        return json!([]);
    }
    let mut sorted = array(&v["results"]).to_vec();
    sorted.sort_by(|a, b| interest(b).total_cmp(&interest(a)));
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for r in sorted {
        let name = normalized(&r);
        if !name.is_empty() && seen.contains(&name) {
            continue;
        }
        let cat = category(&r).0;
        let cap = if cat == "other" { 2 } else { 3 };
        if counts.get(cat).copied().unwrap_or(0) >= cap {
            continue;
        }
        if !name.is_empty() {
            seen.insert(name);
        }
        *counts.entry(cat).or_default() += 1;
        selected.push(r);
        if selected.len() >= limit {
            break;
        }
    }
    selected.sort_by(|a, b| {
        priority(a)
            .cmp(&priority(b))
            .then_with(|| interest(b).total_cmp(&interest(a)))
    });
    json!(selected)
}
pub fn insight(v: &Value) -> Value {
    let rows = array(v);
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for r in rows {
        let label = category(r).1;
        if let Some((_, n)) = counts.iter_mut().find(|(l, _)| *l == label) {
            *n += 1
        } else {
            counts.push((label, 1));
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    counts.truncate(3);
    let themes = counts
        .iter()
        .map(|(label, count)| json!({"label":label,"count":count}))
        .collect::<Vec<_>>();
    let mut standout = rows
        .iter()
        .filter(|r| text(r, "riskLevel") != "neutral")
        .collect::<Vec<_>>();
    standout.sort_by(|a, b| interest(b).total_cmp(&interest(a)));
    json!({"themes":themes,"standout":standout.first().copied().or_else(||rows.first()),"protectiveCount":rows.iter().filter(|r|text(r,"riskLevel")=="decreased").count(),"elevatedCount":rows.iter().filter(|r|text(r,"riskLevel")=="increased").count(),"headline":if counts.is_empty(){"Your first matches are ready to explore.".to_string()}else{format!("Your first matches point to {}.",counts.iter().map(|(l,_)|*l).collect::<Vec<_>>().join(", "))}})
}
