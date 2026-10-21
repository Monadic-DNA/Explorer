//! Deterministic batch analysis. Native clients use a bounded CPU pool; WASM workers
//! execute the identical scorer without requiring shared memory or cross-origin isolation.
use crate::{results,risk,text};
use serde_json::{json,Value};
use std::collections::HashMap;
#[derive(Clone,Copy)]
pub enum Genotypes<'a> { Session(&'a HashMap<String,Value>), Json(&'a serde_json::Map<String,Value>) }
impl<'a> Genotypes<'a> {
    fn get(self,id:&str)->Option<&'a Value>{match self{Self::Session(values)=>values.get(id),Self::Json(values)=>values.get(id)}}
}
fn study(study:&Value,genotypes:Genotypes<'_>,strict:bool,now:&str)->Option<Value> {
    let snps=text(study,"snps");let allele=text(study,"strongest_snp_risk_allele");let size=text(study,"or_or_beta");
    // Most catalog rows do not match this person's DNA. Reject them before parsing
    // effect sizes, constructing JSON or allocating a list of variant IDs.
    if snps.is_empty() || allele.is_empty() {return None}
    let mut matches=serde_json::Map::new();
    if strict {
        if size.is_empty(){return None}
        let mut parts=allele.split('-');let id=parts.next()?;let base=parts.next().filter(|s|!s.is_empty())?;
        let gt=genotypes.get(id)?.as_str()?;
        if gt.len()!=2 || !gt.bytes().all(|c|b"ACGT".contains(&c)) || !gt.contains(base) {return None}
        if !snps.split(|c:char|c==';'||c==','||c.is_whitespace()).any(|s|s==id){return None}
        matches.insert(id.to_string(),json!(gt));
    } else {
        for id in snps.split(|c:char|c==';'||c==','||c.is_whitespace()).filter(|s|!s.is_empty()) {
            if let Some(gt)=genotypes.get(id){matches.insert(id.to_string(),gt.clone());}
        }
        if matches.is_empty(){return None}
    }
    let effect=risk::effect(size,text(study,"ci_text"));
    let analysis=risk::analyze(&json!({"genotypes":matches,"snps":snps,"riskAllele":allele,"effectSize":effect["effectSize"],"effectType":effect["effectType"],"confidenceInterval":study["ci_text"],"gwasId":study["study_accession"]}));
    (analysis["hasMatch"]==true).then(||results::saved(study,&analysis,now))
}
pub fn run(studies:&[Value],genotypes:Genotypes<'_>,strict:bool,now:&str,parallel:bool)->Vec<Value> {
    #[cfg(not(target_arch="wasm32"))]
    if parallel && studies.len()>=512 {
        use rayon::prelude::*;
        static POOL:std::sync::OnceLock<Option<rayon::ThreadPool>>=std::sync::OnceLock::new();
        let pool=POOL.get_or_init(||rayon::ThreadPoolBuilder::new().num_threads(std::thread::available_parallelism().map(usize::from).unwrap_or(1).min(4)).thread_name(|i|format!("explorer-analysis-{i}")).build().ok());
        if let Some(pool)=pool {
            // Indexed collection preserves catalog order even if threads finish out of order.
            return pool.install(||studies.par_iter().map(|row|study(row,genotypes,strict,now)).collect::<Vec<_>>()).into_iter().flatten().collect();
        }
    }
    #[cfg(target_arch="wasm32")]
    let _=parallel;
    studies.iter().filter_map(|row|study(row,genotypes,strict,now)).collect()
}
