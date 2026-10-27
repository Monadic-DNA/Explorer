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
        }
    }
}
static SESSIONS: OnceLock<Mutex<HashMap<u64, Session>>> = OnceLock::new();
/// Lends the session's results to a function that reads a JSON input, without copying them:
/// as `input["results"]`, or as the input itself when `input` is None.
fn lend<R>(session:&mut Session,input:Option<Value>,f:impl FnOnce(&Value)->R)->R {
    let rows=Value::Array(std::mem::take(&mut session.results));
    let (value,out)=match input {
        Some(mut object)=>{object["results"]=rows;let out=f(&object);(object["results"].take(),out)}
        None=>{let out=f(&rows);(rows,out)}
    };
    if let Value::Array(rows)=value{session.results=rows}
    out
}
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
            let Value::Object(genotypes)=parsed["genotypes"].take() else{return Err("Invalid parsed genotypes".into())};
            let genotypes=genotypes.into_iter().collect();
            session.genotypes=genotypes;session.results.clear();session.result_positions.clear();
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
        // Hosts page, look up and summarize results here instead of holding a full copy.
        "session_results_page"=>{
            let filter=text(&input,"filter").to_lowercase();
            let direction=text(&input,"direction").to_lowercase();
            let mut rows:Vec<&Value>=session.results.iter().filter(|r|(filter.is_empty()||text(r,"traitName").to_lowercase().contains(&filter))&&(direction.is_empty()||direction=="all"||text(r,"riskLevel")==direction)).collect();
            let number=|v:&Value|v.as_f64().or_else(||v.as_str().and_then(|s|s.parse().ok())).unwrap_or(0.0);
            match text(&input,"sort") {
                // Beta values are trait changes; odds ratios compare on a log scale.
                "effect"=>rows.sort_by(|a,b|{let size=|r:&Value|{let v=number(&r["riskScore"]);if text(r,"effectType")=="beta"{v.abs()}else{v.max(1e-9).ln().abs()}};size(b).total_cmp(&size(a))}),
                "pvalue"=>rows.sort_by(|a,b|number(&b["pValueMlog"]).total_cmp(&number(&a["pValueMlog"]))),
                _=>{}
            }
            let offset=input["offset"].as_u64().unwrap_or(0) as usize;let limit=input["limit"].as_u64().unwrap_or(100).min(500) as usize;
            let page:Vec<&Value>=rows.iter().skip(offset).take(limit).copied().collect();
            Ok(json!({"total":rows.len(),"count":session.results.len(),"rows":page}))
        },
        "session_result"=>Ok(session.result_positions.get(&input["studyId"].to_string()).map(|&i|session.results[i].clone()).unwrap_or(Value::Null)),
        "session_insight"=>Ok(lend(session,None,crate::preview::insight)),
        "session_report_prompt"=>Ok(lend(session,Some(json!({"kind":input["kind"],"customization":input["customization"],"context":input["context"]})),crate::reports::prompt)),
        "session_report_groups"=>crate::reports::format_groups(&session.results,input["groups"].as_u64().unwrap_or(1) as usize).map(Value::Array),
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
            apply_snapshot(session,snapshot)
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

pub(crate) fn validate_customization(value:&Value)->Result<(),String> {
    let fields=value["fields"].as_object().ok_or("Invalid customization fields")?;
    if fields.len()>100 || !fields.values().all(|v|v.as_str().is_some_and(|s|s.len()<=10000)) || value["context"].as_str().is_none_or(|s|s.len()>100000) {return Err("Invalid customization".into());}
    Ok(())
}

fn apply_snapshot(session:&mut Session,mut snapshot:Value)->Result<Value,String> {
    if snapshot["version"]!=1{return Err("Unsupported session backup".into())}
    if !snapshot["metadata"].is_object(){return Err("Invalid session metadata".into())}
    if !snapshot["genotypes"].as_object().ok_or("Invalid genotypes")?.values().all(Value::is_string){return Err("Invalid genotypes".into())}
    results::validate_snapshot(&snapshot)?;
    if let Some(custom)=snapshot.get("customization"){validate_customization(custom)?;}
    // Validated above; take ownership instead of cloning the largest parts.
    let Value::Object(genotypes)=snapshot["genotypes"].take() else{unreachable!()};
    let Value::Array(rows)=snapshot["results"].take() else{unreachable!()};
    session.genotypes=genotypes.into_iter().collect();
    session.results=rows;session.result_positions=result_positions(&session.results);
    session.metadata=snapshot["metadata"].take();session.metadata["count"]=json!(session.genotypes.len());
    session.customization=snapshot.get_mut("customization").filter(|v|v.is_object()).map(Value::take).unwrap_or_else(||json!({"fields":{},"context":""}));
    Ok(session.metadata.clone())
}
