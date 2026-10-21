use crate::{array, text};
use serde_json::{json, Value};
const COLUMNS: [(&str, &str); 17] = [
    ("Study ID", "studyId"),
    ("GWAS ID", "gwasId"),
    ("Trait Name", "traitName"),
    ("Study Title", "studyTitle"),
    ("Your Genotype", "userGenotype"),
    ("Risk Allele", "riskAllele"),
    ("Effect Size", "effectSize"),
    ("Effect Type", "effectType"),
    ("Risk Score", "riskScore"),
    ("Risk Level", "riskLevel"),
    ("Matched SNP", "matchedSnp"),
    ("Analysis Date", "analysisDate"),
    ("P-Value", "pValue"),
    ("P-Value (-log10)", "pValueMlog"),
    ("Mapped Gene", "mappedGene"),
    ("Sample Size", "sampleSize"),
    ("Replication Sample Size", "replicationSampleSize"),
];
pub fn export(rows: &[Value]) -> String {
    let mut out = vec![COLUMNS.map(|c| c.0).join("\t")];
    for row in rows {
        out.push(
            COLUMNS
                .iter()
                .map(|(_, key)| {
                    let s = match row.get(key) {
                        Some(Value::String(s)) => s.clone(),
                        Some(Value::Number(n)) => n.to_string(),
                        _ => {
                            if *key == "effectType" {
                                "OR".into()
                            } else {
                                String::new()
                            }
                        }
                    };
                    s.replace(['\t', '\r', '\n'], " ")
                })
                .collect::<Vec<_>>()
                .join("\t"),
        );
    }
    out.join("\n")
}
pub fn import(input: &Value) -> Result<Value, String> {
    let content = text(input, "content");
    let filename = text(input, "fileName");
    if filename.ends_with(".json") {
        let session: Value = serde_json::from_str(content).map_err(|_| "Invalid file format")?;
        if !session["results"].is_array() {
            return Err("Invalid file format".into());
        }
        return Ok(session);
    }
    let mut lines = content.lines().filter(|s| !s.trim().is_empty());
    let header = lines
        .next()
        .unwrap_or("")
        .trim_start_matches('\u{feff}')
        .split('\t')
        .collect::<Vec<_>>();
    let body = lines.collect::<Vec<_>>();
    if body.is_empty() {
        return Err("File is empty or has no data rows".into());
    }
    for name in [
        "Study ID",
        "GWAS ID",
        "Trait Name",
        "Study Title",
        "Your Genotype",
        "Risk Allele",
        "Effect Size",
        "Risk Score",
        "Risk Level",
        "Matched SNP",
        "Analysis Date",
    ] {
        if !header.contains(&name) {
            return Err("Invalid TSV headers - not a valid results file".into());
        }
    }
    let mut rows = Vec::new();
    for line in body {
        let cols = line.split('\t').collect::<Vec<_>>();
        if cols.len() < 11 {
            continue;
        }
        let mut row = json!({});
        for (name, key) in COLUMNS {
            let value = header
                .iter()
                .position(|h| *h == name)
                .and_then(|i| cols.get(i))
                .copied()
                .unwrap_or("");
            if key == "studyId" {
                row[key] = json!(crate::risk::float(value).unwrap_or(0.0) as i64);
            } else if key == "riskScore" {
                row[key] = json!(crate::risk::float(value).unwrap_or(0.0));
            } else if key == "effectType" {
                row[key] = json!(if value.is_empty() { "OR" } else { value });
            } else if key == "riskLevel" {
                row[key] = json!(if value.is_empty() { "neutral" } else { value });
            } else if !value.is_empty()
                || [
                    "traitName",
                    "studyTitle",
                    "userGenotype",
                    "riskAllele",
                    "effectSize",
                    "matchedSnp",
                    "analysisDate",
                ]
                .contains(&key)
            {
                row[key] = json!(value);
            }
        }
        rows.push(row);
    }
    Ok(
        json!({"fileName":filename,"createdDate":text(input,"now"),"totalVariants":0,"results":rows}),
    )
}
pub fn saved(study: &Value, analysis: &Value, now: &str) -> Value {
    let mut v = json!({"studyId":study["id"],"traitName":text(study,"disease_trait"),"studyTitle":text(study,"study"),"analysisDate":now});
    for key in [
        "userGenotype",
        "riskAllele",
        "effectSize",
        "effectType",
        "riskScore",
        "riskLevel",
        "matchedSnp",
    ] {
        v[key] = analysis[key].clone();
    }
    for (source, target) in [
        ("study_accession", "gwasId"),
        ("p_value", "pValue"),
        ("pvalue_mlog", "pValueMlog"),
        ("mapped_gene", "mappedGene"),
        ("initial_sample_size", "sampleSize"),
        ("replication_sample_size", "replicationSampleSize"),
    ] {
        if !text(study, source).is_empty() {
            v[target] = study[source].clone();
        }
    }
    v
}
pub fn validate_snapshot(v: &Value) -> Result<&[Value], String> {
    if v["version"] != 1 || !v["results"].is_array() {
        return Err("Unsupported results snapshot".into());
    }
    let rows = array(&v["results"]);
    if !rows.iter().all(|r| {
        r.is_object()
            && r["studyId"].is_number()
            && r["riskScore"].is_number()
            && ["increased", "decreased", "neutral"].contains(&text(r, "riskLevel"))
            && [
                "traitName",
                "studyTitle",
                "userGenotype",
                "riskAllele",
                "effectSize",
                "matchedSnp",
                "analysisDate",
            ]
            .iter()
            .all(|k| r[k].is_string())
    }) {
        return Err("Invalid saved results in snapshot".into());
    }
    Ok(rows)
}
