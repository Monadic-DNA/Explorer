//! cargo run --release -p explorer-core --example benchmark_run_all
use explorer_core::dispatch;
use serde_json::{json,Value};
use std::time::Instant;
fn main(){
    let count=50000;
    let studies:Vec<Value>=(0..count).map(|i|json!({"id":i,"study_accession":"GCST_BENCH","snps":if i%5==0{"rs1"}else{"rs2"},"strongest_snp_risk_allele":if i%5==0{"rs1-A"}else{"rs2-A"},"or_or_beta":"1.2","ci_text":"[1.1-1.3]","disease_trait":"Synthetic benchmark","study":"Synthetic benchmark"})).collect();
    let mut expected=None;
    for parallel in [false,true]{
        let input=json!({"studies":studies,"genotypes":{"rs1":"AG"},"strict":true,"now":"2026-10-21T00:00:00Z","parallel":parallel});
        let start=Instant::now();let actual=dispatch("analyze_studies",input).unwrap();let elapsed=start.elapsed();
        println!("{}",json!({"parallel":parallel,"studies":count,"matches":actual.as_array().unwrap().len(),"milliseconds":elapsed.as_secs_f64()*1000.0,"availableWorkers":std::thread::available_parallelism().map(usize::from).unwrap_or(1).min(4)}));
        if let Some(expected)=&expected{assert_eq!(&actual,expected)}else{expected=Some(actual)}
    }
}
