use crate::{array, genotype, results, risk, text};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
struct Session {
    genotypes: serde_json::Map<String, Value>,
    results: Vec<Value>,
    metadata: Value,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            genotypes: Default::default(),
            results: Vec::new(),
            metadata: json!({"count":0}),
        }
    }
}
static SESSIONS: OnceLock<Mutex<HashMap<u64, Session>>> = OnceLock::new();
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
pub fn dispatch(op: &str, input: Value) -> Result<Value, String> {
    let mut sessions = SESSIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Session unavailable")?;
    if op == "session_create" {
        if sessions.len() >= 16 {
            return Err("Close unused sessions before creating more".into());
        }
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        sessions.insert(id, Session::default());
        return Ok(json!(id));
    }
    let id = input["session"].as_u64().ok_or("Invalid session")?;
    if op == "session_close" {
        sessions.remove(&id);
        return Ok(Value::Null);
    }
    let session = sessions.get_mut(&id).ok_or("Session is closed")?;
    match op{
        "session_import"=>{
            let decoded=if input.get("bytes").is_some(){Some(crate::files::decode(&input)?)}else{None};
            let content=decoded.as_deref().unwrap_or_else(||text(&input,"content"));let mut parsed=genotype::parse_mode(content,text(&input,"format"),true);
            if parsed["success"]!=true{return Err(text(&parsed,"error").into())}
            let genotypes=parsed["genotypes"].take().as_object().cloned().ok_or("Invalid parsed genotypes")?;
            session.genotypes=genotypes;session.results.clear();
            session.metadata=json!({"count":session.genotypes.len(),"detectedFormat":parsed["detectedFormat"],"fileHash":crate::crypto::file_hash(content),"fileName":text(&input,"fileName")});Ok(session.metadata.clone())
        },
        "session_metadata"=>Ok(session.metadata.clone()),
        "session_analyze"=>{
            let mut analyzed=Vec::new();
            for study in array(&input["studies"]){
                let effect=risk::effect(text(study,"or_or_beta"),text(study,"ci_text"));
                let mut matches=serde_json::Map::new();for id in risk::variants(text(study,"snps")){if let Some(gt)=session.genotypes.get(&id){matches.insert(id,gt.clone());}}
                if input["strict"]==true{
                    let parts=text(study,"strongest_snp_risk_allele").split('-').collect::<Vec<_>>();
                    let Some(base)=parts.get(1).filter(|s|!s.is_empty())else{continue};
                    let Some(gt)=session.genotypes.get(parts[0]).and_then(Value::as_str)else{continue};
                    if gt.len()!=2||!gt.chars().all(|c|"ACGT".contains(c))||!gt.contains(*base){continue}
                    matches.retain(|key,_|key==parts[0]);
                }
                let analysis=risk::analyze(&json!({"genotypes":matches,"snps":study["snps"],"riskAllele":study["strongest_snp_risk_allele"],"effectSize":effect["effectSize"],"effectType":effect["effectType"],"confidenceInterval":study["ci_text"],"gwasId":study["study_accession"]}));
                if analysis["hasMatch"]!=true{continue}let saved=results::saved(study,&analysis,text(&input,"now"));
                if let Some(old)=session.results.iter_mut().find(|r|r["studyId"]==saved["studyId"]){*old=saved.clone()}else{session.results.push(saved.clone())}
                analyzed.push(saved);
            }Ok(json!(analyzed))
        },
        "session_results"=>Ok(json!(session.results)),
        "session_export"=>Ok(json!(results::export(&session.results))),
        "session_import_results"=>{let value=results::import(&input)?;session.results=array(&value["results"]).to_vec();Ok(json!(session.results.len()))},
        "session_snapshot"=>Ok(json!({"version":1,"genotypes":session.genotypes,"results":session.results,"metadata":session.metadata}).to_string().into()),
        "session_restore"=>{
            let snapshot:Value=serde_json::from_str(text(&input,"snapshot")).map_err(|_|"Invalid session backup")?;
            if snapshot["version"]!=1{return Err("Unsupported session backup".into())}
            if !snapshot["metadata"].is_object(){return Err("Invalid session metadata".into())}
            let genotypes=snapshot["genotypes"].as_object().ok_or("Invalid genotypes")?;
            if !genotypes.values().all(Value::is_string){return Err("Invalid genotypes".into())}
            let results=results::validate_snapshot(&snapshot)?.to_vec();
            session.genotypes=genotypes.clone();session.results=results;session.metadata=snapshot["metadata"].clone();Ok(session.metadata.clone())
        },
        "session_clear"=>{*session=Session::default();Ok(Value::Null)},
        _=>Err("Unknown session operation".into())
    }
}
