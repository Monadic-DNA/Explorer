use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
struct Variant {
    rsid: String,
    chromosome: String,
    position: u64,
    genotype: String,
}

fn provider(content: &str) -> Option<&'static str> {
    let p = content
        .chars()
        .take(4000)
        .collect::<String>()
        .to_lowercase();
    [
        ("living dna", "livingdna"),
        ("mapmygenome", "mapmygenome"),
        ("myheritage", "myheritage"),
        ("familytreedna", "ftdna"),
        ("family tree dna", "ftdna"),
        ("famfinder", "ftdna"),
        ("ancestrydna", "ancestrydna"),
        ("ancestry.com", "ancestrydna"),
        ("23andme", "23andme"),
        ("monadic dna", "monadic"),
    ]
    .into_iter()
    .find(|(key, _)| p.contains(key))
    .map(|(_, v)| v)
}
fn strip(s: &str) -> String {
    s.trim().replace('"', "")
}
fn chromosome(s: &str) -> bool {
    matches!(s, "X" | "Y" | "MT" | "M" | "26")
        || s.parse::<u8>()
            .is_ok_and(|n| (1..=22).contains(&n) && n.to_string() == s)
}
fn position(s: &str) -> Option<u64> {
    s.trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}
fn monadic_header(s: &str) -> bool {
    let upper = strip(s).to_uppercase();
    let normalized = upper.split_whitespace().collect::<Vec<_>>().join("\t");
    upper.starts_with("RSID,CHROMOSOME,POSITION,RESULT")
        || upper.starts_with("RSID,CHROMOSOME,POSITION,GENOTYPE")
        || ((upper.contains(',') || upper.contains('\t'))
            && (normalized.starts_with("RSID\tCHROMOSOME\tPOSITION\tRESULT")
                || normalized.starts_with("RSID\tCHROMOSOME\tPOSITION\tGENOTYPE")))
}
fn map_header(s: &str) -> bool {
    let cols = s
        .trim()
        .split('\t')
        .map(|s| strip(s).to_lowercase())
        .collect::<Vec<_>>();
    let has = |s: &str| cols.iter().any(|v| v == s);
    (has("rsid") || has("snp name") || has("snp.name"))
        && (has("chr") || has("chromosome"))
        && has("position")
        && has("allele1...plus")
        && has("allele2...plus")
}
fn error(kind: &str, header: bool) -> Value {
    let message=match (kind,header){
        ("monadic",true)=>"No valid Monadic DNA header found. Expected: RSID,CHROMOSOME,POSITION,RESULT".into(),
        ("ancestrydna",true)=>"No valid AncestryDNA header found. Expected header with rsid, chromosome, position columns.".into(),
        ("mapmygenome",true)=>"No valid Mapmygenome header found. Expected Illumina-style SNP table with plus-strand allele columns.".into(),
        _=>format!("No valid genotype data found in file. Please ensure the file is in {} format.",match kind{"monadic"=>"Monadic DNA","ancestrydna"=>"AncestryDNA","mapmygenome"=>"Mapmygenome",_=>"23andMe"}),
    };
    json!({"success":false,"error":message})
}
fn row(rsid: &str, chr: &str, pos: u64, genotype: &str) -> Variant {
    Variant {
        rsid: rsid.into(),
        chromosome: chr.into(),
        position: pos,
        genotype: genotype.into(),
    }
}

fn parse_kind(content: &str, kind: &str, compact: bool) -> Value {
    let mut rows = Vec::new();
    let mut total = 0;
    let mut header = kind == "23andme";
    let mut delimiter = if kind == "monadic" { ',' } else { '\t' };
    let mut idx = [0usize, 1, 2, 3, 4];
    for line in content.lines().map(str::trim).filter(|s| !s.is_empty()) {
        if !header {
            match kind {
                "monadic" => {
                    if line.starts_with('#') {
                        continue;
                    }
                    if monadic_header(line) {
                        header = true;
                        delimiter = if line.contains('\t') { '\t' } else { ',' };
                    }
                }
                "mapmygenome" => {
                    if map_header(line) {
                        header = true;
                        let cols = line
                            .split('\t')
                            .map(|s| strip(s).to_lowercase())
                            .collect::<Vec<_>>();
                        idx = [
                            cols.iter()
                                .position(|c| {
                                    ["rsid", "snp name", "snp.name"].contains(&c.as_str())
                                })
                                .unwrap(),
                            cols.iter()
                                .position(|c| ["chr", "chromosome"].contains(&c.as_str()))
                                .unwrap(),
                            cols.iter().position(|c| c == "position").unwrap(),
                            cols.iter().position(|c| c == "allele1...plus").unwrap(),
                            cols.iter().position(|c| c == "allele2...plus").unwrap(),
                        ];
                    }
                }
                _ => {
                    let candidate = line.strip_prefix('#').map(str::trim).unwrap_or(line);
                    let lower = candidate.to_lowercase();
                    let is_header = if line.starts_with('#') {
                        (lower.contains("rsid") || lower.contains("name"))
                            && lower.contains("chromosome")
                            && lower.contains("position")
                            && lower.contains("allele")
                    } else {
                        lower.contains("rsid")
                            && lower.contains("chromosome")
                            && lower.contains("position")
                    };
                    if is_header {
                        header = true;
                        delimiter = if candidate.contains('\t') { '\t' } else { ',' };
                        let cols = candidate
                            .split(delimiter)
                            .map(|s| strip(s).to_lowercase())
                            .collect::<Vec<_>>();
                        idx[3] = cols
                            .iter()
                            .position(|c| {
                                c.contains("allele1")
                                    || c.contains("allele 1")
                                    || c.contains("allele_1")
                                    || c.ends_with("allele")
                            })
                            .unwrap_or(3);
                        idx[4] = cols
                            .iter()
                            .position(|c| {
                                c.contains("allele2")
                                    || c.contains("allele 2")
                                    || c.contains("allele_2")
                            })
                            .unwrap_or(4);
                    }
                }
            }
            continue;
        }
        if (kind == "23andme" || kind == "monadic") && line.starts_with('#') {
            continue;
        }
        total += 1;
        if kind == "23andme" {
            let cols = line.split_whitespace().collect::<Vec<_>>();
            if cols.len() < 4 {
                continue;
            }
            let (rsid, chr) = (cols[0], cols[1]);
            let Some(pos) = position(cols[2]) else {
                continue;
            };
            if !rsid.starts_with("rs") || !chromosome(chr) || pos == 0 {
                continue;
            }
            let mut gt = cols[3].to_string();
            if cols.len() >= 5 && gt.len() == 1 && cols[4].len() == 1 {
                gt.push_str(cols[4]);
            }
            if gt == "-" || gt == "--" {
                rows.push(row(rsid, chr, pos, "--"));
                continue;
            }
            if gt.len() != 2 || !gt.chars().all(|c| "ATGCID-".contains(c)) {
                continue;
            }
            rows.push(row(rsid, chr, pos, &gt));
            continue;
        }
        let raw = line.split(delimiter).map(strip).collect::<Vec<_>>();
        let cols = if kind == "ancestrydna" {
            raw.into_iter()
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>()
        } else {
            raw
        };
        if kind == "monadic" {
            if cols.len() < 4 {
                continue;
            }
            let Some(pos) = position(&cols[2]) else {
                continue;
            };
            let gt = &cols[3];
            if !cols[0].starts_with("rs")
                || gt.len() != 2
                || !gt.chars().all(|c| "ATGC-".contains(c))
            {
                continue;
            }
            rows.push(row(&cols[0], &cols[1], pos, gt));
            continue;
        }
        if cols.len() <= idx[0].max(idx[1]).max(idx[2]).max(idx[3]) {
            continue;
        }
        let (rsid, chr) = (&cols[idx[0]], &cols[idx[1]]);
        let Some(pos) = position(&cols[idx[2]]) else {
            continue;
        };
        if (!rsid.starts_with("rs")
            && !(kind == "ancestrydna"
                && !rsid.is_empty()
                && rsid.chars().all(|c| c.is_ascii_digit())))
            || !chromosome(chr)
            || pos == 0
        {
            continue;
        }
        let a1 = cols
            .get(idx[3])
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("0");
        let a2 = cols.get(idx[4]).map(String::as_str).unwrap_or("");
        if kind == "ancestrydna" && a2.is_empty() && a1.len() == 2 {
            if a1.chars().all(|c| "ATGCID-".contains(c)) {
                rows.push(row(rsid, if chr == "M" { "MT" } else { chr }, pos, a1));
            }
            continue;
        }
        if kind == "mapmygenome" && ((a1 == "--" && a2 == "--") || (a1 == "-" && a2 == "-")) {
            rows.push(row(rsid, chr, pos, "--"));
            continue;
        }
        let a2 = if a2.is_empty() { "0" } else { a2 };
        if a1.len() != 1
            || a2.len() != 1
            || !a1.chars().chain(a2.chars()).all(|c| "ATGCID0-".contains(c))
        {
            continue;
        }
        let gt = if a1 == "0" || a2 == "0" {
            "--".to_string()
        } else {
            format!("{a1}{a2}")
        };
        let chr = if kind == "ancestrydna" && (chr == "M" || chr == "26") {
            "MT"
        } else {
            chr
        };
        rows.push(row(rsid, chr, pos, &gt));
    }
    if !header {
        return error(kind, true);
    }
    if rows.is_empty() {
        return error(kind, false);
    }
    let detected = if kind == "mapmygenome" {
        "mapmygenome"
    } else {
        provider(content).unwrap_or(kind)
    };
    if compact {
        let count = rows.len();
        let genotypes = rows
            .into_iter()
            .map(|row| (row.rsid, Value::String(row.genotype)))
            .collect::<serde_json::Map<_, _>>();
        json!({"success":true,"totalVariants":total,"validVariants":count,"genotypes":genotypes,"detectedFormat":detected})
    } else {
        json!({"success":true,"totalVariants":total,"validVariants":rows.len(),"data":rows,"detectedFormat":detected})
    }
}

pub fn parse(content: &str, format: &str) -> Value {
    parse_mode(content, format, false)
}
pub fn parse_mode(content: &str, format: &str, compact: bool) -> Value {
    let content = content
        .trim_start_matches('\u{feff}')
        .replace('\0', "")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if ["23andme", "monadic", "ancestrydna", "mapmygenome"].contains(&format) {
        return parse_kind(&content, format, compact);
    }
    let lines = content.lines().take(50).collect::<Vec<_>>();
    if lines.iter().any(|l| map_header(l)) {
        return parse_kind(&content, "mapmygenome", compact);
    }
    if lines.iter().any(|l| monadic_header(l)) {
        return parse_kind(&content, "monadic", compact);
    }
    if lines.iter().any(|l| {
        let l = l.trim();
        let lower = l.to_lowercase();
        !l.starts_with('#')
            && lower.contains("rsid")
            && lower.contains("chromosome")
            && lower.contains("position")
    }) {
        return parse_kind(&content, "ancestrydna", compact);
    }
    if lines.iter().any(|l| l.trim().starts_with('#')) {
        if lines.iter().any(|l| {
            let s = l.trim().to_lowercase();
            s.starts_with('#')
                && (s.contains("rsid") || s.contains("name"))
                && s.contains("chromosome")
                && s.contains("allele")
        }) {
            let result = parse_kind(&content, "ancestrydna", compact);
            if result["success"] == true {
                return result;
            }
        }
        return parse_kind(&content, "23andme", compact);
    }
    for kind in ["23andme", "ancestrydna", "monadic"] {
        let result = parse_kind(&content, kind, compact);
        if result["success"] == true {
            return result;
        }
    }
    json!({"success":false,"error":"Unable to detect file format. Supported formats include 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, and compatible raw DNA exports."})
}
