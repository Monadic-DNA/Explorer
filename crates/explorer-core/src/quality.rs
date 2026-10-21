use crate::{risk::float, text};
use serde_json::{json, Value};
pub fn sample_size(s: &str) -> Option<f64> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let values = RE
        .get_or_init(|| regex::Regex::new(r"\d[\d,]*").unwrap())
        .find_iter(s)
        .filter_map(|m| m.as_str().replace(',', "").parse::<f64>().ok())
        .filter(|n| *n > 0.0)
        .collect::<Vec<_>>();
    let max = values.iter().copied().reduce(f64::max)?;
    Some(if values.iter().all(|n| (n - max).abs() / max < 0.2) {
        max
    } else {
        values.iter().sum()
    })
}
pub fn p_value(s: &str) -> Option<f64> {
    let s = s.trim().to_lowercase().replace('×', "x");
    static SIMPLE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    if SIMPLE
        .get_or_init(|| regex::Regex::new(r"^\d+(\.\d+)?(e-?\d+)?$").unwrap())
        .is_match(&s)
    {
        return s.parse().ok();
    }
    static SCI: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    if let Some(c) = SCI
        .get_or_init(|| regex::Regex::new(r"([\d.]+)\s*x\s*10\s*\^\s*(-?\d+)").unwrap())
        .captures(&s)
    {
        return Some(c[1].parse::<f64>().ok()? * 10f64.powf(c[2].parse().ok()?));
    }
    if let Some((_, tail)) = s.split_once('<') {
        return p_value(tail);
    }
    None
}
pub fn flags(v: &Value) -> Value {
    let mut flags = Vec::new();
    let n = v["sampleSize"].as_f64();
    let p = v["pValue"].as_f64();
    let log = v["logPValue"].as_f64();
    for (condition, message, severity) in [
        (
            n.is_some_and(|n| n < 500.0),
            "Very small discovery cohort (<500 participants)",
            "major",
        ),
        (
            p.is_some_and(|p| p > 5e-7),
            "Association well above genome-wide significance (p > 5e-7)",
            "major",
        ),
        (
            n.is_some_and(|n| (500.0..1000.0).contains(&n)),
            "Small discovery cohort (500-1000 participants)",
            "minor",
        ),
        (
            p.is_some_and(|p| p > 5e-8 && p <= 5e-7),
            "Association slightly above genome-wide significance (5e-8 < p < 5e-7)",
            "minor",
        ),
        (
            log.is_some_and(|p| p < 6.0),
            "Moderate signal strength (−log10 p < 6)",
            "minor",
        ),
    ] {
        if condition {
            flags.push(json!({"message":message,"severity":severity}));
        }
    }
    json!(flags)
}
pub fn evidence(v: &Value) -> Value {
    let normalized = text(v, "pValue").replace(char::is_whitespace, "");
    let normalized = regex::Regex::new("(?i)x10\\^")
        .unwrap()
        .replace(&normalized, "e");
    let p = float(&normalized)
        .filter(|n| n.is_finite() && *n > 0.0)
        .or_else(|| {
            float(text(v, "pValueMlog"))
                .filter(|n| n.is_finite() && *n > 0.0)
                .map(|n| 10f64.powf(-n))
        });
    let n = regex::Regex::new(r"\d[\d,]*")
        .unwrap()
        .find_iter(text(v, "sampleSize"))
        .filter_map(|m| m.as_str().replace(',', "").parse::<u64>().ok())
        .max();
    let significant = p.is_some_and(|p| p <= 5e-8);
    let large = n.is_some_and(|n| n >= 10000);
    let band = if significant && (!text(v, "replicationSampleSize").trim().is_empty() || large) {
        "strong"
    } else if significant || large {
        "moderate"
    } else {
        "limited"
    };
    let label = match band {
        "strong" => "Stronger GWAS evidence",
        "moderate" => "Moderate GWAS evidence",
        _ => "Limited context available",
    };
    let mut details = Vec::new();
    if let Some(p) = p {
        details.push(
            if p <= 5e-8 {
                "Genome-wide significant p-value"
            } else {
                "Association p-value reported"
            }
            .to_string(),
        );
    }
    for (key, label) in [
        ("sampleSize", "Initial sample"),
        ("replicationSampleSize", "Replication sample"),
    ] {
        if !text(v, key).is_empty() {
            details.push(format!("{label}: {}", text(v, key)));
        }
    }
    details.push(
        if text(v, "effectType") == "beta" {
            "Beta effect, not an odds ratio"
        } else {
            "Odds ratio is relative, not absolute risk"
        }
        .into(),
    );
    details.push("Educational interpretation, not diagnosis".into());
    json!({"band":band,"label":label,"details":details})
}
fn pow(mut a: u64, mut exp: u64, n: u64) -> u64 {
    let mut r = 1;
    while exp > 0 {
        if exp % 2 == 1 {
            r = ((r as u128 * a as u128) % n as u128) as u64;
        }
        a = ((a as u128 * a as u128) % n as u128) as u64;
        exp /= 2;
    }
    r
}
pub fn prime(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    for p in [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37] {
        if n % p == 0 {
            return n == p;
        }
    }
    let mut d = n - 1;
    let mut r = 0;
    while d % 2 == 0 {
        d /= 2;
        r += 1;
    }
    'w: for a in [2, 325, 9375, 28178, 450775, 9780504, 1795265022] {
        let a = a % n;
        if a == 0 {
            continue;
        }
        let mut x = pow(a, d, n);
        if x == 1 || x == n - 1 {
            continue;
        }
        for _ in 1..r {
            x = pow(x, 2, n);
            if x == n - 1 {
                continue 'w;
            }
        }
        return false;
    }
    true
}
pub fn delicate(n: u64) -> bool {
    if !prime(n) {
        return false;
    }
    let mut digits = n.to_string().into_bytes();
    for i in 0..digits.len() {
        let original = digits[i];
        for d in b'0'..=b'9' {
            if d == original {
                continue;
            }
            digits[i] = d;
            if let Ok(candidate) = std::str::from_utf8(&digits).unwrap().parse() {
                if prime(candidate) {
                    return false;
                }
            }
        }
        digits[i] = original;
    }
    true
}
pub fn promo(s: &str) -> Value {
    let s = s.trim();
    let parsed = s.parse::<u64>();
    let (valid, message) = match parsed {
        Ok(n) if n.to_string() == s && n >= 1 && n <= 999999999 => {
            if delicate(n) {
                (true, "🎉 Valid promo code! Free access granted.")
            } else {
                (false, "Not a valid promo code")
            }
        }
        Ok(n) if n.to_string() == s => (false, "Code out of valid range"),
        _ => (false, "Invalid code format"),
    };
    json!({"valid":valid,"discount":if valid{0}else{1},"message":message})
}
