//! Native encrypted store and sync (docs/native-data-store.md).
use explorer_core::{catalog_analyze_next, catalog_close, catalog_open, core_call, dispatch, store_close, store_import_genotype, store_open};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

fn parse(text: String) -> Value { serde_json::from_str(&text).unwrap() }
fn ok(text: String) -> Value { let v = parse(text); assert_eq!(v["ok"], true, "{v}"); v["value"].clone() }
fn call(op: &str, input: Value) -> Result<Value, String> {
    let v = parse(core_call(json!({"version":1,"operation":op,"input":input}).to_string()));
    if v["ok"] == true { Ok(v["value"].clone()) } else { Err(v["error"].as_str().unwrap_or("").to_string()) }
}
fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("explorer-store-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir); std::fs::create_dir_all(&dir).unwrap(); dir
}
const NOW: &str = "2026-10-27T00:00:00Z";
const DNA: &str = "# 23andMe\nrs1 1 100 AG\nrs2 1 200 GG\nrs3 1 300 CC\n";
const OTHER_DNA: &str = "# 23andMe\nrs1 1 100 GG\nrs2 1 200 GG\nrs3 1 300 CC\n";
// The layout scripts/catalog-snapshot.mjs writes.
fn catalog(version: &str) -> String {
    format!("EXPLORER-CATALOG\t1\t{version}\t4\t2\n#studies\tstudy_accession\tstudy\tinitial_sample_size\treplication_sample_size\nGCST1\tStudy one\t1,000 cases\t\nGCST2\tStudy two\t500\t200\n#rows\tid\tsnps\tstrongest_snp_risk_allele\tor_or_beta\tci_text\tdisease_trait\tp_value\tpvalue_mlog\tmapped_gene\tstudy\n1\trs1\trs1-A\t0.5\tunit decrease\tHeart rate\t1E-8\t8\tGENE1\t0\n2\trs2\trs2-G\t1.2\t[1.1-1.3]\tType 2 diabetes\t2E-9\t8.7\t\t0\n3\trs3\trs3-C\t3.0\t[2-4]\tHeart failure\t1E-9\t9\tGENE3\t1\n4\trs9\trs9-A\t1.2\t\tOther\t3E-8\t7.5\tGENE9\t1\n")
}
fn catalog_file(dir: &PathBuf, version: &str) -> String {
    let path = dir.join(format!("{version}.zst"));
    std::fs::write(&path, ruzstd::encoding::compress_to_vec(catalog(version).as_bytes(), ruzstd::encoding::CompressionLevel::Fastest)).unwrap();
    path.to_string_lossy().into()
}
fn run_all(store: u64, catalog: &str) -> Value {
    let handle = ok(catalog_open(catalog.into()))["handle"].as_u64().unwrap();
    let mut last;
    loop { last = ok(catalog_analyze_next(handle, store, 2, NOW.into())); if last["done"] == true { break } }
    catalog_close(handle);
    last
}
fn open(dir: &PathBuf, key: u8) -> u64 { ok(store_open(dir.join("explorer.db").to_string_lossy().into(), vec![key; 32]))["handle"].as_u64().unwrap() }
fn ids(page: &Value) -> Vec<i64> { page["rows"].as_array().unwrap().iter().map(|r| r["studyId"].as_i64().unwrap()).collect() }

#[test]
fn run_all_into_the_encrypted_store_matches_the_scorer() {
    let dir = temp("run");
    let catalog = catalog_file(&dir, "v1");
    let store = open(&dir, 1);
    let metadata = ok(store_import_genotype(store, DNA.as_bytes().to_vec(), "genome.txt".into()));
    assert_eq!(metadata["count"], 3);
    let done = run_all(store, &catalog);
    // Same rows the existing scorer produces from the same studies.
    let studies = json!([
        {"id":1,"study_accession":"GCST1","disease_trait":"Heart rate","study":"Study one","snps":"rs1","strongest_snp_risk_allele":"rs1-A","or_or_beta":"0.5","ci_text":"unit decrease","initial_sample_size":"1,000 cases","replication_sample_size":null,"p_value":"1E-8","pvalue_mlog":"8","mapped_gene":"GENE1"},
        {"id":2,"study_accession":"GCST1","disease_trait":"Type 2 diabetes","study":"Study one","snps":"rs2","strongest_snp_risk_allele":"rs2-G","or_or_beta":"1.2","ci_text":"[1.1-1.3]","initial_sample_size":"1,000 cases","replication_sample_size":null,"p_value":"2E-9","pvalue_mlog":"8.7","mapped_gene":null},
        {"id":3,"study_accession":"GCST2","disease_trait":"Heart failure","study":"Study two","snps":"rs3","strongest_snp_risk_allele":"rs3-C","or_or_beta":"3.0","ci_text":"[2-4]","initial_sample_size":"500","replication_sample_size":"200","p_value":"1E-9","pvalue_mlog":"9","mapped_gene":"GENE3"},
        {"id":4,"study_accession":"GCST2","disease_trait":"Other","study":"Study two","snps":"rs9","strongest_snp_risk_allele":"rs9-A","or_or_beta":"1.2","ci_text":null,"initial_sample_size":"500","replication_sample_size":"200","p_value":"3E-8","pvalue_mlog":"7.5","mapped_gene":"GENE9"}
    ]);
    let expected = dispatch("analyze_studies", json!({"genotypes":{"rs1":"AG","rs2":"GG","rs3":"CC"},"studies":studies,"strict":true,"now":NOW})).unwrap();
    assert_eq!(done["saved"], 3);
    let all = call("store_results_page", json!({"store":store,"limit":500})).unwrap();
    assert_eq!(all["rows"], expected);
    assert_eq!(call("store_metadata", json!({"store":store})).unwrap()["catalogVersion"], "v1");
    // Paging, filtering, direction and sorting, with the same orderings as the session views.
    assert_eq!(ids(&call("store_results_page", json!({"store":store,"offset":1,"limit":1})).unwrap()), vec![2]);
    let heart = call("store_results_page", json!({"store":store,"filter":"HEART"})).unwrap();
    assert_eq!((heart["total"].as_i64(), heart["count"].as_i64(), ids(&heart)), (Some(2), Some(3), vec![1, 3]));
    assert_eq!(ids(&call("store_results_page", json!({"store":store,"direction":"decreased"})).unwrap()), vec![1]);
    assert_eq!(ids(&call("store_results_page", json!({"store":store,"sort":"effect"})).unwrap()), vec![3, 1, 2]);
    // Highest -log10(p) first: 9 (1E-9), 8.7 (2E-9), 8 (1E-8).
    assert_eq!(ids(&call("store_results_page", json!({"store":store,"sort":"pvalue"})).unwrap()), vec![3, 2, 1]);
    assert_eq!(call("store_result", json!({"store":store,"studyId":3})).unwrap()["studyId"], 3);
    assert_eq!(call("store_result", json!({"store":store,"studyId":99})).unwrap(), Value::Null);
    // Report prompt and Overview groups are identical to the JSON operations over the same results.
    let custom = json!({"age":40});
    assert_eq!(call("store_report_prompt", json!({"store":store,"kind":"Health","customization":custom,"context":"note"})).unwrap(),
               dispatch("report_prompt", json!({"kind":"Health","results":expected,"customization":custom,"context":"note"})).unwrap());
    let groups = call("store_report_groups", json!({"store":store,"groups":2})).unwrap();
    let partitioned = dispatch("partition_results", json!({"results":expected,"groups":2})).unwrap();
    for (group, rows) in groups.as_array().unwrap().iter().zip(partitioned.as_array().unwrap()) {
        assert_eq!(group["text"], dispatch("format_results", rows.clone()).unwrap());
    }
    assert_eq!(call("store_export", json!({"store":store})).unwrap(), dispatch("export_results", expected.clone()).unwrap());
    // A complete run drops catalog results the catalog no longer produces; a re-import clears them.
    ok(store_import_genotype(store, OTHER_DNA.as_bytes().to_vec(), "genome.txt".into()));
    assert_eq!(call("store_result_count", json!({"store":store})).unwrap(), 0);
    assert_eq!(run_all(store, &catalog)["saved"], 2);
    store_close(store);
    // Data persists across close and reopen; operations fail while closed.
    assert!(call("store_result_count", json!({"store":store})).is_err());
    let reopened = open(&dir, 1);
    assert_eq!(call("store_result_count", json!({"store":reopened})).unwrap(), 2);
    store_close(reopened);
}

#[test]
fn the_store_is_encrypted_and_rejects_the_wrong_key() {
    let dir = temp("key");
    let store = open(&dir, 7);
    ok(store_import_genotype(store, DNA.as_bytes().to_vec(), "genome.txt".into()));
    call("store_set_customization", json!({"store":store,"customization":{"fields":{"personalConditions":"asthma"},"context":"private note"}})).unwrap();
    store_close(store);
    let path = dir.join("explorer.db");
    let bytes = std::fs::read(&path).unwrap();
    // Distinctive strings only: short ones like "AG" occur by chance in ciphertext.
    for secret in ["asthma", "private note", "genome.txt", "SQLite format", "personalConditions"] {
        assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()), "{secret} is readable on disk");
    }
    let wrong = parse(store_open(path.to_string_lossy().into(), vec![8; 32]));
    assert_eq!(wrong["ok"], false);
    // A damaged page fails to open or read without crashing.
    let mut damaged = bytes.clone(); for b in &mut damaged[4096..4200] { *b ^= 0xff; }
    std::fs::write(&path, damaged).unwrap();
    let opened = parse(store_open(path.to_string_lossy().into(), vec![7; 32]));
    if opened["ok"] == true {
        let handle = opened["value"]["handle"].as_u64().unwrap();
        let _ = call("store_customization", json!({"store":handle}));
        store_close(handle);
    }
}

/// An in-memory stand-in for the user's cloud storage (iCloud or Google Drive): compare-and-set on revision per record.
#[derive(Default)]
struct Server { records: HashMap<String, (i64, String)> }
impl Server {
    fn sync(&mut self, store: u64, catalog_version: &str) {
        let list: Vec<Value> = self.records.iter().map(|(record, (revision, _))| json!({"record":record,"revision":revision})).collect();
        for record in call("store_sync_wanted", json!({"store":store,"records":list})).unwrap().as_array().unwrap() {
            let (revision, ciphertext) = self.records[record.as_str().unwrap()].clone();
            call("store_sync_apply", json!({"store":store,"record":record,"revision":revision,"ciphertext":ciphertext,"catalogVersion":catalog_version})).unwrap();
        }
        for out in call("store_sync_outgoing", json!({"store":store})).unwrap().as_array().unwrap() {
            let record = out["record"].as_str().unwrap().to_string();
            let current = self.records.get(&record).map_or(0, |r| r.0);
            assert_eq!(out["baseRevision"].as_i64().unwrap(), current, "pull before push");
            self.records.insert(record.clone(), (current + 1, out["ciphertext"].as_str().unwrap().into()));
            call("store_sync_pushed", json!({"store":store,"record":record,"revision":current + 1,"version":out["version"],"hash":out["hash"]})).unwrap();
        }
    }
}

#[test]
fn a_new_device_fills_in_from_sync_and_edits_merge() {
    let (one, two) = (temp("sync-one"), temp("sync-two"));
    let catalog = catalog_file(&one, "v1");
    let mut server = Server::default();
    let a = open(&one, 1);
    ok(store_import_genotype(a, DNA.as_bytes().to_vec(), "genome.txt".into()));
    run_all(a, &catalog);
    call("store_set_customization", json!({"store":a,"customization":{"fields":{"age":"40"},"context":""}})).unwrap();
    let enabled = call("store_sync_enable", json!({"store":a})).unwrap();
    server.sync(a, "v1");
    assert_eq!(server.records.len(), 3, "genotype, results and customization upload");
    // Nothing changed, so a second sync uploads nothing.
    let before = server.records.clone().into_iter().map(|(k, v)| (k, v.0)).collect::<HashMap<_, _>>();
    server.sync(a, "v1");
    assert_eq!(server.records.iter().map(|(k, v)| (k.clone(), v.0)).collect::<HashMap<_, _>>(), before);

    // A new device with a different local key restores everything from the same sync key.
    let b = open(&two, 2);
    assert_eq!(call("store_sync_enable", json!({"store":b,"syncKey":enabled["syncKey"]})).unwrap()["account"], enabled["account"]);
    server.sync(b, "v1");
    assert_eq!(call("store_metadata", json!({"store":b})).unwrap()["count"], 3);
    assert_eq!(call("store_result_count", json!({"store":b})).unwrap(), 3, "results arrive without a catalog run");
    assert_eq!(call("store_needs_match", json!({"store":b,"catalogVersion":"v1"})).unwrap(), false);
    assert_eq!(call("store_customization", json!({"store":b})).unwrap()["fields"]["age"], "40");

    // Edits to different fields on each device are both kept.
    call("store_set_customization", json!({"store":a,"customization":{"fields":{"age":"41"},"context":""}})).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    call("store_set_customization", json!({"store":b,"customization":{"fields":{"age":"40","diet":"vegetarian"},"context":""}})).unwrap();
    server.sync(a, "v1"); server.sync(b, "v1"); server.sync(a, "v1");
    for device in [a, b] {
        let fields = &call("store_customization", json!({"store":device})).unwrap()["fields"];
        assert_eq!((fields["age"].as_str(), fields["diet"].as_str()), (Some("41"), Some("vegetarian")));
    }

    // A newer DNA import on one device replaces the other's; stale results are cleared until rematched.
    std::thread::sleep(std::time::Duration::from_millis(5));
    ok(store_import_genotype(b, OTHER_DNA.as_bytes().to_vec(), "new.txt".into()));
    server.sync(b, "v1"); server.sync(a, "v1");
    assert_eq!(call("store_metadata", json!({"store":a})).unwrap()["fileName"], "new.txt");
    assert_eq!(call("store_needs_match", json!({"store":a,"catalogVersion":"v1"})).unwrap(), true);

    // Results computed with a different catalog are not used; the device rematches instead.
    let c_dir = temp("sync-three");
    let c = open(&c_dir, 3);
    call("store_sync_enable", json!({"store":c,"syncKey":enabled["syncKey"]})).unwrap();
    run_all(b, &catalog); server.sync(b, "v1");
    server.sync(c, "v2");
    assert_eq!(call("store_result_count", json!({"store":c})).unwrap(), 0);
    assert_eq!(call("store_needs_match", json!({"store":c,"catalogVersion":"v2"})).unwrap(), true);

    // Records are bound to their account, name and revision.
    let (revision, ciphertext) = server.records["customization"].clone();
    assert!(call("store_sync_apply", json!({"store":c,"record":"customization","revision":revision + 1,"ciphertext":ciphertext})).is_err());
    assert!(call("store_sync_apply", json!({"store":c,"record":"genotype","revision":revision,"ciphertext":ciphertext})).is_err());
    for handle in [a, b, c] { store_close(handle); }
}

#[test]
fn report_passes_sync_without_losing_credits_or_uses() {
    let (one, two) = (temp("passes-one"), temp("passes-two"));
    let mut server = Server::default();
    let a = open(&one, 5);
    let key = call("store_sync_enable", json!({"store":a})).unwrap()["syncKey"].clone();
    let credit = |store: u64, id: &str| call("store_pass_credit", json!({"store":store,"transactionId":id,"reportType":"healthspan"})).unwrap();
    assert_eq!(credit(a, "t1"), true);
    assert_eq!(credit(a, "t1"), false, "a transaction is credited once");
    credit(a, "t2");
    server.sync(a, "v1");
    // A new device sees both passes.
    let b = open(&two, 6);
    call("store_sync_enable", json!({"store":b,"syncKey":key})).unwrap();
    server.sync(b, "v1");
    assert_eq!(call("store_passes", json!({"store":b})).unwrap(), json!({"healthspan":2}));
    // Each device uses a pass and one buys another, before either syncs.
    assert_eq!(call("store_pass_use", json!({"store":a,"reportType":"healthspan"})).unwrap(), true);
    assert_eq!(call("store_pass_use", json!({"store":b,"reportType":"healthspan"})).unwrap(), true);
    credit(b, "t3");
    server.sync(a, "v1"); server.sync(b, "v1"); server.sync(a, "v1");
    // Both uses count once each, so t1 and t2 are spent and only t3 remains everywhere.
    for device in [a, b] { assert_eq!(call("store_passes", json!({"store":device})).unwrap(), json!({"healthspan":1})); }
    assert_eq!(call("store_pass_use", json!({"store":a,"reportType":"overview"})).unwrap(), false);
    assert!(call("store_pass_credit", json!({"store":a,"transactionId":"t9","reportType":"chat"})).is_err());
    for handle in [a, b] { store_close(handle); }
}

#[test]
fn research_angles_use_results_from_similar_studies_in_order() {
    let dir = temp("research");
    let catalog = catalog_file(&dir, "v1");
    let store = open(&dir, 9);
    ok(store_import_genotype(store, DNA.as_bytes().to_vec(), "genome.txt".into()));
    run_all(store, &catalog);
    let angle = |accessions: Value| call("store_research_angle_prompt", json!({"store":store,"query":"Q","keyword":"heart","llmDescription":"D","accessions":accessions})).unwrap();
    // GCST2 is more similar than GCST1, so its result comes first; unknown studies are ignored.
    let prompt = angle(json!(["GCST9","GCST2","GCST1"]));
    assert_eq!(prompt["resultsCount"], 3);
    let content = prompt["messages"][0]["content"].as_str().unwrap();
    assert!(content.find("1. Heart failure").unwrap() < content.find("2. Heart rate").unwrap(), "{content}");
    assert_eq!(angle(json!(["GCST1"]))["resultsCount"], 2);
    // No similar studies: fall back to the scores furthest from neutral (OR 3.0 squared first).
    let fallback = angle(json!([]));
    assert_eq!(fallback["resultsCount"], 3);
    assert!(fallback["messages"][0]["content"].as_str().unwrap().contains("1. Heart failure"));
    store_close(store);
}

