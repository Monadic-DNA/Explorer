use crate::text;
use serde_json::{json, Value};

pub fn float(s: &str) -> Option<f64> {
    // The catalog overwhelmingly contains plain numbers. Avoid regex capture/cache
    // contention across CPU workers; retain the parseFloat-compatible prefix fallback.
    let trimmed=s.trim();let bytes=trimmed.as_bytes();
    let numeric_start=bytes.first().is_some_and(|c|c.is_ascii_digit() || *c==b'.' || ((*c==b'+' || *c==b'-') && bytes.get(1).is_some_and(|b|b.is_ascii_digit() || *b==b'.')));
    if numeric_start {if let Ok(value)=trimmed.parse::<f64>(){return Some(value)}}
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"^[\s]*([+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))")
            .unwrap()
    });
    re.captures(s).and_then(|c| c[1].parse().ok())
}
pub fn variants(s: &str) -> Vec<String> {
    s.split(|c: char| c == ';' || c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}
pub fn valid(s: &str) -> bool {
    !s.is_empty() && s != "00" && !s.chars().all(|c| c == '-')
}
pub fn effect(value: &str, ci: &str) -> Value {
    if value.is_empty() {
        return json!({"effectType":"OR","effectSize":"1"});
    }
    let ci = ci.to_lowercase();
    let increase = ci.contains("increase");
    let decrease = ci.contains("decrease");
    let adjusted = if decrease && !increase {
        float(value)
            .map(|x| (-x.abs()).to_string())
            .unwrap_or("NaN".into())
    } else {
        value.into()
    };
    json!({"effectType":if increase||decrease{"beta"}else{"OR"},"effectSize":adjusted})
}
pub fn score(genotype: &str, allele: &str, size: &str, kind: &str) -> Value {
    let Some(effect) = float(size) else {
        return json!({"score":1,"level":"neutral"});
    };
    if !valid(genotype) {
        return json!({"score":1,"level":"neutral"});
    }
    let risk = allele.rsplit('-').next().unwrap_or("");
    let n = genotype.chars().filter(|c| c.to_string() == risk).count() as i32;
    let (score, level) = if kind == "beta" {
        (
            effect * n as f64,
            if n == 0 {
                "neutral"
            } else if effect > 0.0 {
                "increased"
            } else {
                "decreased"
            },
        )
    } else if n == 0 || effect == 1.0 {
        (1.0, "neutral")
    } else {
        (
            effect.powi(n),
            if effect > 1.0 {
                "increased"
            } else {
                "decreased"
            },
        )
    };
    json!({"score":score,"level":level})
}
pub fn analyze(input: &Value) -> Value {
    let (snps, allele, size) = (
        text(input, "snps"),
        text(input, "riskAllele"),
        text(input, "effectSize"),
    );
    if snps.is_empty() || allele.is_empty() || size.is_empty() {
        return json!({"hasMatch":false});
    }
    let kind = if text(input, "effectType") == "beta" {
        "beta"
    } else {
        "OR"
    };
    let parts = allele.split('-').collect::<Vec<_>>();
    let risk_snp = parts[0];
    let base = parts.get(1).copied().unwrap_or("");
    let mut matches = Vec::new();
    for snp in variants(snps) {
        let Some(gt) = input
            .get("genotypes")
            .and_then(|g| g.get(&snp))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if !valid(gt) || (snp == risk_snp && !base.is_empty() && !gt.contains(base)) {
            continue;
        }
        let result = score(gt, allele, size, kind);
        matches
            .push(json!({"snp":snp,"genotype":gt,"score":result["score"],"level":result["level"]}));
    }
    if matches.is_empty() {
        return json!({"hasMatch":false});
    }
    let first = &matches[0];
    let mut result = json!({"hasMatch":true,"userGenotype":first["genotype"],"riskAllele":allele,"effectSize":size,"effectType":kind,"riskScore":first["score"],"riskLevel":first["level"],"matchedSnp":first["snp"],"allMatches":matches});
    for key in ["gwasId", "confidenceInterval"] {
        if !text(input, key).is_empty() {
            result[key] = input[key].clone();
        }
    }
    result
}

#[cfg(test)]
mod numeric_tests {
    #[test]
    fn numeric_fast_path_preserves_javascript_prefix_parsing() {
        for (text,expected) in [("  +1.25  ",Some(1.25)),("-2.5e-2",Some(-0.025)),(".5",Some(0.5)),("1.25 units",Some(1.25)),("0x10",Some(0.0)),("1e+",Some(1.0)),("NaN",None),("inf",None),("-.5",Some(-0.5))] {assert_eq!(super::float(text),expected,"{text}");}
        assert_eq!(super::float("Infinity"),Some(f64::INFINITY));
    }
}
