use crate::{array, genotype, results, text};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
struct Session {
    genotypes: HashMap<String, Value>,
    results: Vec<Value>,
    result_positions:HashMap<String,usize>,
    metadata: Value,
    customization: Value,
    sealed_genotype: Option<(String,Value)>,
}
// Best-effort wiping of owned session buffers on lock/close. OS/runtime copies cannot be guaranteed erased.
fn wipe_value(value:&mut Value) {
    use zeroize::Zeroize;
    match value {
        Value::String(s)=>s.zeroize(),
        Value::Array(items)=>items.iter_mut().for_each(wipe_value),
        Value::Object(items)=>for (mut key,mut value) in std::mem::take(items) {key.zeroize();wipe_value(&mut value)},
        _=>{}
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        for (mut key,mut value) in std::mem::take(&mut self.genotypes) {key.zeroize();wipe_value(&mut value)}
        for (mut id,_) in std::mem::take(&mut self.result_positions){id.zeroize();}
        self.results.iter_mut().for_each(wipe_value);wipe_value(&mut self.metadata);wipe_value(&mut self.customization);
    }
}
impl Default for Session {
    fn default() -> Self {
        Self {
            genotypes: Default::default(),
            results: Vec::new(),
            result_positions:HashMap::new(),
            metadata: json!({"count":0}),
            customization: json!({"fields":{},"context":""}),
            sealed_genotype:None,
        }
    }
}
static SESSIONS: OnceLock<Mutex<HashMap<u64, Session>>> = OnceLock::new();
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
/// Read-only access to a session's genotypes for the bundled catalog's pre-filter.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn with_genotypes<R>(id: u64, f: impl FnOnce(&HashMap<String, Value>) -> R) -> Result<R, String> {
    let sessions = SESSIONS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    Ok(f(&sessions.get(&id).ok_or("Session is closed")?.genotypes))
}
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
            let Value::Object(genotypes)=parsed["genotypes"].take() else{return Err("Invalid parsed genotypes".into())};
            let genotypes=genotypes.into_iter().collect();
            session.genotypes=genotypes;session.results.clear();session.result_positions.clear();session.sealed_genotype=None;
            session.metadata=json!({"count":session.genotypes.len(),"detectedFormat":parsed["detectedFormat"],"fileHash":crate::crypto::file_hash(content),"fileName":text(&input,"fileName")});Ok(session.metadata.clone())
        },
        "session_metadata"=>Ok(session.metadata.clone()),
        "session_analyze"|"session_analyze_count"=>{
            let analyzed=crate::analysis::run(array(&input["studies"]),crate::analysis::Genotypes::Session(&session.genotypes),input["strict"]==true,text(&input,"now"),input["parallel"]!=false);
            // Update existing matches in linear time, keeping stable insertion order and
            // the prior last-write-wins behavior for repeated study IDs.
            for saved in &analyzed {
                let id=saved["studyId"].to_string();
                if let Some(&index)=session.result_positions.get(&id){session.results[index]=saved.clone();}
                else{session.result_positions.insert(id,session.results.len());session.results.push(saved.clone());}
            }
            if op=="session_analyze_count"{Ok(json!(analyzed.len()))}else{Ok(json!(analyzed))}
        },
        "session_results"=>Ok(json!(session.results)),
        "session_result_count"=>Ok(json!(session.results.len())),
        "session_retain_results"=>{
            // studyIds use the same string form as result_positions keys.
            let keep:std::collections::HashSet<&str>=array(&input["studyIds"]).iter().filter_map(Value::as_str).collect();
            let before=session.results.len();
            session.results.retain(|row|keep.contains(row["studyId"].to_string().as_str()));
            session.result_positions=result_positions(&session.results);
            Ok(json!(before-session.results.len()))
        },
        "session_export"=>Ok(json!(results::export(&session.results))),
        "session_import_results"=>{let value=results::import(&input)?;session.results=array(&value["results"]).to_vec();session.result_positions=result_positions(&session.results);Ok(json!(session.results.len()))},
        "session_persist"=>{
            let customization:Value=serde_json::from_str(text(&input,"customization")).map_err(|_|"Invalid customization")?;
            validate_customization(&customization)?;
            session.customization=customization;
            Ok(json!({"version":1,"genotypes":session.genotypes,"results":session.results,"metadata":session.metadata,"customization":session.customization}).to_string().into())
        },
        "session_customization"=>Ok(session.customization.clone()),
        "session_snapshot"=>Ok(json!({"version":1,"genotypes":session.genotypes,"results":session.results,"metadata":session.metadata,"customization":session.customization}).to_string().into()),
        "session_restore"=>{
            let snapshot:Value=serde_json::from_str(text(&input,"snapshot")).map_err(|_|"Invalid session backup")?;
            if snapshot["version"]!=1{return Err("Unsupported session backup".into())}
            if !snapshot["metadata"].is_object(){return Err("Invalid session metadata".into())}
            let genotypes=snapshot["genotypes"].as_object().ok_or("Invalid genotypes")?;
            if !genotypes.values().all(Value::is_string){return Err("Invalid genotypes".into())}
            let results=results::validate_snapshot(&snapshot)?.to_vec();
            if let Some(custom)=snapshot.get("customization"){validate_customization(custom)?;}
            session.genotypes=genotypes.iter().map(|(k,v)|(k.clone(),v.clone())).collect();session.sealed_genotype=None;session.results=results;session.result_positions=result_positions(&session.results);session.metadata=snapshot["metadata"].clone();session.metadata["count"]=json!(session.genotypes.len());session.customization=snapshot.get("customization").filter(|v|v.is_object()).cloned().unwrap_or_else(||json!({"fields":{},"context":""}));Ok(session.metadata.clone())
        },
        "session_clear"=>{*session=Session::default();Ok(Value::Null)},
        _=>Err("Unknown session operation".into())
    }
}

fn result_positions(rows:&[Value])->HashMap<String,usize> {
    let mut positions=HashMap::with_capacity(rows.len());
    for (i,row) in rows.iter().enumerate(){positions.entry(row["studyId"].to_string()).or_insert(i);}
    positions
}

fn validate_customization(value:&Value)->Result<(),String> {
    let fields=value["fields"].as_object().ok_or("Invalid customization fields")?;
    if fields.len()>100 || !fields.values().all(|v|v.as_str().is_some_and(|s|s.len()<=10000)) || value["context"].as_str().is_none_or(|s|s.len()>100000) {return Err("Invalid customization".into());}
    Ok(())
}

pub fn persist(id:u64,key:&[u8],vault_id:&str,revision:u64,nonce:&[u8],customization:&str)->Result<Value,String> {
    use sha2::Digest;
    let custom:Value=serde_json::from_str(customization).map_err(|_|"Invalid customization")?;validate_customization(&custom)?;
    let mut sessions=SESSIONS.get_or_init(||Mutex::new(HashMap::new())).lock().map_err(|_|"Session unavailable")?;
    let session=sessions.get_mut(&id).ok_or("Session is closed")?;
    let owner=format!("{vault_id}:{:x}",sha2::Sha256::digest(key));
    let genotype=match &session.sealed_genotype {
        Some((saved,genotype)) if saved==&owner=>genotype.clone(),
        _=>{let encrypted=crate::vault::seal_genotypes(&json!(session.genotypes),key,vault_id,nonce)?;session.sealed_genotype=Some((owner,encrypted.clone()));encrypted}
    };
    session.customization=custom;
    let snapshot=json!({"version":1,"results":session.results,"metadata":session.metadata,"customization":session.customization});
    crate::vault::seal_state(snapshot,genotype,key,vault_id,revision,nonce)
}
