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


#[test]
fn session_result_views_match_the_json_operations_without_host_copies() {
    let genotypes=json!({"rs1":"AG","rs2":"GG","rs3":"CC","rs4":"TT"});
    let studies=json!([
        {"id":1,"study_accession":"GCST1","disease_trait":"Heart rate","study":"S1","snps":"rs1","strongest_snp_risk_allele":"rs1-A","or_or_beta":"0.5","ci_text":"unit decrease","p_value":"1E-8","pvalue_mlog":"8","mapped_gene":"G1"},
        {"id":2,"study_accession":"GCST2","disease_trait":"Type 2 diabetes","study":"S2","snps":"rs2","strongest_snp_risk_allele":"rs2-G","or_or_beta":"1.2","ci_text":"[1.1-1.3]","p_value":"1E-20","pvalue_mlog":"20","mapped_gene":"G2"},
        {"id":3,"study_accession":"GCST3","disease_trait":"Heart failure","study":"S3","snps":"rs3","strongest_snp_risk_allele":"rs3-C","or_or_beta":"3.0","ci_text":"[2-4]","p_value":"1E-9","pvalue_mlog":"9","mapped_gene":"G3"},
        {"id":4,"study_accession":"GCST4","disease_trait":"Height","study":"S4","snps":"rs4","strongest_snp_risk_allele":"rs4-T","or_or_beta":"0.1","ci_text":"unit increase","p_value":"1E-12","pvalue_mlog":"12","mapped_gene":"G4"}
    ]);
    let now="2026-10-26T00:00:00Z";
    let session=dispatch("session_create",Value::Null).unwrap().as_u64().unwrap();
    dispatch("session_restore",json!({"session":session,"snapshot":json!({"version":1,"genotypes":genotypes,"results":[],"metadata":{"count":4}}).to_string()})).unwrap();
    let results=dispatch("session_analyze",json!({"session":session,"studies":studies,"strict":true,"now":now})).unwrap();
    assert_eq!(results.as_array().unwrap().len(),4);
    let ids=|page:&Value|page["rows"].as_array().unwrap().iter().map(|r|r["studyId"].as_i64().unwrap()).collect::<Vec<_>>();
    let page=|extra:Value|{let mut input=json!({"session":session});for (k,v) in extra.as_object().unwrap(){input[k]=v.clone()}dispatch("session_results_page",input).unwrap()};
    // Paging keeps catalog order and reports totals.
    let first=page(json!({"offset":0,"limit":2}));
    assert_eq!((first["total"].as_u64(),first["count"].as_u64(),ids(&first)),(Some(4),Some(4),vec![1,2]));
    assert_eq!(ids(&page(json!({"offset":2,"limit":2}))),vec![3,4]);
    // Filter is case-insensitive on the trait name; direction uses riskLevel.
    let heart=page(json!({"filter":"HEART"}));
    assert_eq!((heart["total"].as_u64(),heart["count"].as_u64(),ids(&heart)),(Some(2),Some(4),vec![1,3]));
    assert_eq!(ids(&page(json!({"direction":"decreased"}))),vec![1]);
    // Effect size uses riskScore, which counts risk-allele copies: |ln 3²|=2.20, |-0.5|=0.5,
    // |ln 1.2²|=0.36, |0.1×2|=0.2. P-value: highest -log10(p) first.
    assert_eq!(ids(&page(json!({"sort":"effect"}))),vec![3,1,2,4]);
    assert_eq!(ids(&page(json!({"sort":"pvalue"}))),vec![2,4,3,1]);
    assert_eq!(dispatch("session_result",json!({"session":session,"studyId":3})).unwrap()["studyId"],3);
    assert_eq!(dispatch("session_result",json!({"session":session,"studyId":99})).unwrap(),Value::Null);
    // Report prompts, insight and Overview groups are identical to the JSON operations.
    let custom=json!({"age":40});
    assert_eq!(dispatch("session_report_prompt",json!({"session":session,"kind":"Health","customization":custom,"context":"note"})).unwrap(),
               dispatch("report_prompt",json!({"kind":"Health","results":results,"customization":custom,"context":"note"})).unwrap());
    assert_eq!(dispatch("session_insight",json!({"session":session})).unwrap(),dispatch("preview_insight",results.clone()).unwrap());
    let groups=dispatch("session_report_groups",json!({"session":session,"groups":2})).unwrap();
    let expected=dispatch("partition_results",json!({"results":results,"groups":2})).unwrap();
    for (group,rows) in groups.as_array().unwrap().iter().zip(expected.as_array().unwrap()) {
        assert_eq!(group["count"],rows.as_array().unwrap().len());
        assert_eq!(group["text"],dispatch("format_results",rows.clone()).unwrap());
    }
    // Lending results to these views must leave the session's results intact.
    assert_eq!(dispatch("session_results",json!({"session":session})).unwrap(),results);
    dispatch("session_close",json!({"session":session})).unwrap();
}
