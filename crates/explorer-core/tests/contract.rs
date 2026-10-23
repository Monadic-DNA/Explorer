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
fn bundled_catalog_snapshots_match_in_chunks_like_the_json_batch_path() {
    let genotypes=json!({"rs1":"AG","rs2":"GG"});
    let studies=json!([
        {"id":1,"study_accession":"GCST1","disease_trait":"Trait","study":"Study one","snps":"rs1","strongest_snp_risk_allele":"rs1-A","or_or_beta":"0.5","ci_text":"unit decrease","initial_sample_size":"1,000 cases","replication_sample_size":null,"p_value":"1E-8","pvalue_mlog":"8","mapped_gene":"GENE1"},
        {"id":2,"study_accession":"GCST1","disease_trait":"Trait","study":"Study one","snps":"rs2","strongest_snp_risk_allele":"rs2-G","or_or_beta":"1.2","ci_text":"[1.1-1.3]","initial_sample_size":"1,000 cases","replication_sample_size":null,"p_value":"2E-9","pvalue_mlog":"8.7","mapped_gene":null},
        {"id":3,"study_accession":"GCST2","disease_trait":"Other","study":"Study two","snps":"rs9","strongest_snp_risk_allele":"rs9-A","or_or_beta":"1.2","ci_text":null,"initial_sample_size":"500","replication_sample_size":"200","p_value":"3E-8","pvalue_mlog":"7.5","mapped_gene":"GENE9"}
    ]);
    // The layout scripts/catalog-snapshot.mjs writes.
    let text="EXPLORER-CATALOG\t1\t2026-10-23-test\t3\t2\n#studies\tstudy_accession\tstudy\tinitial_sample_size\treplication_sample_size\nGCST1\tStudy one\t1,000 cases\t\nGCST2\tStudy two\t500\t200\n#rows\tid\tsnps\tstrongest_snp_risk_allele\tor_or_beta\tci_text\tdisease_trait\tp_value\tpvalue_mlog\tmapped_gene\tstudy\n1\trs1\trs1-A\t0.5\tunit decrease\tTrait\t1E-8\t8\tGENE1\t0\n2\trs2\trs2-G\t1.2\t[1.1-1.3]\tTrait\t2E-9\t8.7\t\t0\n3\trs9\trs9-A\t1.2\t\tOther\t3E-8\t7.5\tGENE9\t1\n";
    let now="2026-10-23T00:00:00Z";
    let session=dispatch("session_create",Value::Null).unwrap().as_u64().unwrap();
    // A stale saved result from an earlier catalog must be dropped by a complete run.
    let stale=dispatch("analyze_studies",json!({"genotypes":genotypes,"studies":[{"id":99,"study_accession":"GCST9","disease_trait":"Old","study":"Old","snps":"rs1","strongest_snp_risk_allele":"rs1-A","or_or_beta":"1.5","ci_text":""}],"strict":true,"now":now})).unwrap();
    dispatch("session_restore",json!({"session":session,"snapshot":json!({"version":1,"genotypes":genotypes,"results":stale,"metadata":{"count":2}}).to_string()})).unwrap();
    let expected=dispatch("analyze_studies",json!({"genotypes":genotypes,"studies":studies,"strict":true,"now":now})).unwrap();
    let file=std::env::temp_dir().join(format!("explorer-catalog-test-{}.zst",std::process::id()));
    std::fs::write(&file,compress(text)).unwrap();
    let opened:Value=serde_json::from_str(&explorer_core::catalog_open(file.to_string_lossy().into())).unwrap();
    std::fs::remove_file(&file).unwrap();
    assert_eq!(opened["ok"],true,"{opened}");
    assert_eq!(opened["value"]["rows"],3);
    assert_eq!(opened["value"]["version"],"2026-10-23-test");
    let handle=opened["value"]["handle"].as_u64().unwrap();
    let mut matches=Vec::new();
    loop {
        let chunk:Value=serde_json::from_str(&explorer_core::catalog_analyze_next(handle,session,2,now.into())).unwrap();
        assert_eq!(chunk["ok"],true,"{chunk}");
        matches.extend(chunk["value"]["matches"].as_array().unwrap().iter().cloned());
        if chunk["value"]["done"]==true{break}
    }
    explorer_core::catalog_close(handle);
    assert_eq!(Value::Array(matches),expected);
    assert_eq!(dispatch("session_results",json!({"session":session})).unwrap(),expected);
    let closed:Value=serde_json::from_str(&explorer_core::catalog_analyze_next(handle,session,2,now.into())).unwrap();
    assert_eq!(closed["ok"],false);
    let missing:Value=serde_json::from_str(&explorer_core::catalog_open("/nonexistent/catalog.zst".into())).unwrap();
    assert_eq!(missing["ok"],false);
    dispatch("session_close",json!({"session":session})).unwrap();
    fn compress(text:&str)->Vec<u8>{ruzstd::encoding::compress_to_vec(text.as_bytes(),ruzstd::encoding::CompressionLevel::Fastest)}
}
