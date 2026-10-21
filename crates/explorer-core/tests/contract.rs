use explorer_core::{core_call, dispatch};
use serde_json::{json, Value};

#[test]
fn same_contract_as_web_and_mobile() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/core.json")).unwrap();
    for fixture in fixtures {
        let actual = dispatch(
            fixture["operation"].as_str().unwrap(),
            fixture["input"].clone(),
        )
        .unwrap();
        fn same(a: &Value, b: &Value) -> bool {
            match (a, b) {
                (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
                (Value::Array(a), Value::Array(b)) => {
                    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
                }
                (Value::Object(a), Value::Object(b)) => {
                    a.len() == b.len()
                        && a.iter().all(|(k, a)| b.get(k).is_some_and(|b| same(a, b)))
                }
                _ => a == b,
            }
        }
        assert!(
            same(&actual, &fixture["expected"]),
            "{}: actual={actual} expected={}",
            fixture["name"],
            fixture["expected"]
        );
    }
}

#[test]
fn malformed_requests_are_errors_not_panics() {
    for request in ["invalid", "{}", r#"{"version":2,"operation":"version"}"#] {
        let result: Value = serde_json::from_str(&core_call(request.into())).unwrap();
        assert_eq!(result["ok"], false);
    }
    assert_eq!(dispatch("version", Value::Null).unwrap()["protocol"], 1);
}

#[test]
fn exact_snp_matching_and_beta_direction() {
    let effect = dispatch("effect", json!({"value":"0.5","ci":"unit decrease"})).unwrap();
    assert_eq!(effect["effectSize"], "-0.5");
    let result=dispatch("analyze_study",json!({"genotypes":{"rs1":"AG"},"snps":"rs1","riskAllele":"rs1-A","effectSize":"-0.5","effectType":"beta"})).unwrap();
    assert_eq!(result["riskScore"], -0.5);
    assert_eq!(result["riskLevel"], "decreased");
}

#[test]
fn native_binary_import_shares_text_and_gzip_semantics() {
    use std::io::Write;
    let session = dispatch("session_create", Value::Null)
        .unwrap()
        .as_u64()
        .unwrap();
    let source = b"# 23andMe\r\nrs1 1 100 AG\r\n";
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(source).unwrap();
    let compressed = gzip.finish().unwrap();
    let mut last = Value::Null;
    for bytes in [source.to_vec(), compressed] {
        let result: Value = serde_json::from_str(&explorer_core::import_genotype(
            session,
            bytes,
            "sample.txt".into(),
        ))
        .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["value"]["count"], 1);
        if !last.is_null() {
            assert_eq!(result["value"], last);
        }
        last = result["value"].clone();
    }
    let invalid: Value = serde_json::from_str(&explorer_core::import_genotype(
        session,
        vec![255],
        "invalid".into(),
    ))
    .unwrap();
    assert_eq!(invalid["ok"], false);
    assert_eq!(
        dispatch("session_metadata", json!({"session":session})).unwrap(),
        last
    );
    dispatch("session_close", json!({"session":session})).unwrap();
}

#[test]
fn parallel_run_all_is_identical_to_serial_and_stably_ordered() {
    let studies:Vec<Value>=(0..12000).map(|i|json!({"id":i,"snps":"rs1","strongest_snp_risk_allele":"rs1-A","or_or_beta":"0.25","ci_text":if i%2==0{"unit decrease"}else{"unit increase"},"study":"Parity study","disease_trait":"Parity trait"})).collect();
    let input=json!({"genotypes":{"rs1":"AG"},"studies":studies,"strict":true,"now":"2026-10-21T00:00:00Z"});
    let mut serial=input.clone();serial["parallel"]=json!(false);
    let expected=dispatch("analyze_studies",serial).unwrap();
    let parallel=dispatch("analyze_studies",input).unwrap();
    assert_eq!(parallel,expected);
    assert_eq!(parallel.as_array().unwrap().len(),12000);
    for (i,row) in parallel.as_array().unwrap().iter().enumerate(){assert_eq!(row["studyId"],i);}
}
