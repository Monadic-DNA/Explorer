//! Encrypted on-device store for the native apps (docs/native-data-store.md).
//! SQLCipher encrypts every page; hosts pass a hardware-wrapped local key and
//! read results a page at a time instead of holding them in memory.
use crate::{analysis, array, genotype, results, text};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use zeroize::Zeroizing;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS genotypes (rsid TEXT PRIMARY KEY, call TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS results (
  study_id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  trait TEXT NOT NULL, risk_level TEXT NOT NULL, effect_type TEXT NOT NULL,
  effect_rank REAL NOT NULL, p_mlog REAL, risk_score REAL NOT NULL,
  row TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS results_trait ON results(trait COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS results_level ON results(risk_level);
CREATE INDEX IF NOT EXISTS results_effect ON results(effect_rank DESC);
CREATE INDEX IF NOT EXISTS results_p ON results(p_mlog DESC);
CREATE TABLE IF NOT EXISTS customization (field TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, device TEXT NOT NULL);
-- App Store report passes (iOS): a credit per verified purchase and a separate row per use, so merging
-- devices that each used a pass offline keeps both uses. Unused passes = credits - uses per report type.
CREATE TABLE IF NOT EXISTS report_passes (transaction_id TEXT PRIMARY KEY, report_type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS report_pass_uses (use_id TEXT PRIMARY KEY, report_type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_state (record TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, synced_version INTEGER NOT NULL DEFAULT 0, hash TEXT);
";
// The `context` customization entry is stored as a field under this name.
pub(crate) const CONTEXT: &str = "\u{0}context";

pub(crate) struct Store {
    pub(crate) conn: Connection,
    /// Loaded only while Run all needs every genotype; released when the run ends.
    genotypes: Option<HashMap<String, Value>>,
}

static STORES: OnceLock<Mutex<HashMap<u64, Store>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
fn stores() -> MutexGuard<'static, HashMap<u64, Store>> {
    STORES.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}
pub(crate) fn with<R>(handle: u64, f: impl FnOnce(&mut Store) -> Result<R, String>) -> Result<R, String> {
    f(stores().get_mut(&handle).ok_or("Your saved data is locked")?)
}
pub(crate) fn sql(error: rusqlite::Error) -> String {
    format!("Saved data error: {error}")
}
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}
pub(crate) fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| "Secure random numbers are unavailable")?;
    Ok(bytes)
}
pub(crate) use crate::sync_auth::hex;

pub(crate) fn meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional().map_err(sql)
}
pub(crate) fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]).map(|_| ()).map_err(sql)
}
/// Records a local change to a synced record; sync uploads records whose version is ahead of what it last sent.
pub(crate) fn touch(conn: &Connection, record: &str) -> Result<(), String> {
    conn.execute("INSERT INTO sync_state(record,version) VALUES(?1,1) ON CONFLICT(record) DO UPDATE SET version=version+1", [record]).map(|_| ()).map_err(sql)
}

/// Opens (creating if needed) the encrypted database with the device's 32-byte local key.
pub fn open(path: &str, key: &[u8]) -> Result<Value, String> {
    let db_key = crate::vault::domain_key(key, b"monadic-dna/explorer/store/v1")?;
    let conn = Connection::open(path).map_err(sql)?;
    // A raw SQLCipher key skips its passphrase KDF; the local key is already random and hardware-wrapped.
    let pragma = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", hex(&db_key)));
    conn.execute_batch(&pragma).map_err(sql)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).map_err(|_| "Saved data could not be opened with this device's key")?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").map_err(sql)?;
    conn.execute_batch(SCHEMA).map_err(sql)?;
    if meta(&conn, "schema")?.is_none() {
        set_meta(&conn, "schema", "1")?;
        set_meta(&conn, "device", &hex(&random::<16>()?))?;
    }
    let handle = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let store = Store { conn, genotypes: None };
    let metadata = metadata(&store)?;
    stores().insert(handle, store);
    Ok(json!({"handle":handle,"metadata":metadata}))
}
pub fn close(handle: u64) {
    if let Some(mut store) = stores().remove(&handle) {
        release_genotypes(&mut store);
        // Release SQLite's page cache before the connection closes.
        let _ = store.conn.execute_batch("PRAGMA shrink_memory;");
    }
}

pub(crate) fn metadata(store: &Store) -> Result<Value, String> {
    let count: i64 = store.conn.query_row("SELECT count(*) FROM genotypes", [], |r| r.get(0)).map_err(sql)?;
    let mut value = json!({"count":count});
    for key in ["detectedFormat", "fileHash", "fileName", "catalogVersion"] {
        if let Some(v) = meta(&store.conn, key)? { value[key] = json!(v); }
    }
    Ok(value)
}

/// Replaces the stored genotypes with a newly imported DNA file and clears results computed from the old one.
pub fn import_genotype(handle: u64, bytes: Vec<u8>, file_name: &str) -> Result<Value, String> {
    let content = Zeroizing::new(crate::files::decode_bytes(bytes)?);
    let mut parsed = genotype::parse_mode(&content, "", true);
    if parsed["success"] != true { return Err(text(&parsed, "error").into()); }
    let Value::Object(genotypes) = parsed["genotypes"].take() else { return Err("Invalid parsed genotypes".into()) };
    let hash = crate::crypto::file_hash(&content);
    with(handle, |store| {
        let tx = store.conn.transaction().map_err(sql)?;
        tx.execute("DELETE FROM genotypes", []).map_err(sql)?;
        {
            let mut insert = tx.prepare("INSERT OR REPLACE INTO genotypes(rsid,call) VALUES(?1,?2)").map_err(sql)?;
            for (rsid, call) in &genotypes { insert.execute(params![rsid, call.as_str().unwrap_or("")]).map_err(sql)?; }
        }
        tx.execute("DELETE FROM results WHERE source='catalog'", []).map_err(sql)?;
        for (key, value) in [("detectedFormat", text(&parsed, "detectedFormat")), ("fileHash", hash.as_str()), ("fileName", file_name), ("importedAt", &now_ms().to_string())] {
            set_meta(&tx, key, value)?;
        }
        touch(&tx, "genotype")?;
        touch(&tx, "results")?;
        tx.commit().map_err(sql)?;
        store.genotypes = None;
        metadata(store)
    })
}

/// Loads every genotype for Run all. Most rows cannot match, so the catalog pre-filter needs fast lookups.
pub(crate) fn with_genotypes<R>(store: &mut Store, f: impl FnOnce(&HashMap<String, Value>) -> R) -> Result<R, String> {
    if store.genotypes.is_none() {
        let mut rows = store.conn.prepare("SELECT rsid,call FROM genotypes").map_err(sql)?;
        let map = rows.query_map([], |r| Ok((r.get::<_, String>(0)?, Value::String(r.get(1)?)))).map_err(sql)?.collect::<Result<HashMap<_, _>, _>>().map_err(sql)?;
        store.genotypes = Some(map);
    }
    Ok(f(store.genotypes.as_ref().unwrap()))
}
pub(crate) fn release_genotypes(store: &mut Store) {
    if let Some(map) = store.genotypes.take() {
        for (mut rsid, mut call) in map { use zeroize::Zeroize; rsid.zeroize(); if let Value::String(s) = &mut call { s.zeroize(); } }
    }
}

fn number(v: &Value) -> Option<f64> { v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) }
/// Upserts saved results, last write wins per study as in the session.
pub(crate) fn upsert(conn: &Connection, rows: &[Value], source: &str) -> Result<(), String> {
    let mut insert = conn.prepare_cached("INSERT INTO results(study_id,source,trait,risk_level,effect_type,effect_rank,p_mlog,risk_score,row) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
        ON CONFLICT(study_id) DO UPDATE SET source=excluded.source,trait=excluded.trait,risk_level=excluded.risk_level,effect_type=excluded.effect_type,effect_rank=excluded.effect_rank,p_mlog=excluded.p_mlog,risk_score=excluded.risk_score,row=excluded.row").map_err(sql)?;
    for row in rows {
        let id = row["studyId"].as_i64().ok_or("Invalid result")?;
        let score = number(&row["riskScore"]).unwrap_or(1.0);
        // Effect size sorting: beta values are trait changes; odds ratios compare on a log scale.
        let rank = if text(row, "effectType") == "beta" { score.abs() } else { score.max(1e-9).ln().abs() };
        insert.execute(params![id, source, text(row, "traitName"), text(row, "riskLevel"), text(row, "effectType"), rank, number(&row["pValueMlog"]), score, row.to_string()]).map_err(sql)?;
    }
    Ok(())
}
pub(crate) fn result_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT count(*) FROM results", [], |r| r.get(0)).map_err(sql)
}
fn rows(conn: &Connection, query: &str, args: impl rusqlite::Params) -> Result<Vec<Value>, String> {
    let mut statement = conn.prepare(query).map_err(sql)?;
    let out = statement.query_map(args, |r| r.get::<_, String>(0)).map_err(sql)?
        .map(|row| row.map_err(sql).and_then(|text| serde_json::from_str(&text).map_err(|_| "Saved data is corrupt".to_string())))
        .collect();
    out
}
fn all_rows(conn: &Connection) -> Result<Vec<Value>, String> { rows(conn, "SELECT row FROM results ORDER BY study_id", []) }

/// Matches individual studies, looking up only the genotypes they reference.
fn analyze(store: &mut Store, input: &Value) -> Result<Value, String> {
    let studies = array(&input["studies"]);
    let mut genotypes = Map::new();
    {
        let mut lookup = store.conn.prepare_cached("SELECT call FROM genotypes WHERE rsid=?1").map_err(sql)?;
        for study in studies {
            for id in text(study, "snps").split(|c: char| c == ';' || c == ',' || c.is_whitespace()).chain(text(study, "strongest_snp_risk_allele").split('-').take(1)).filter(|s| !s.is_empty()) {
                if let Some(call) = lookup.query_row([id], |r| r.get::<_, String>(0)).optional().map_err(sql)? { genotypes.insert(id.to_string(), json!(call)); }
            }
        }
    }
    let matches = analysis::run(studies, analysis::Genotypes::Json(&genotypes), input["strict"] == true, text(input, "now"), false);
    upsert(&store.conn, &matches, "catalog")?;
    touch(&store.conn, "results")?;
    Ok(json!(matches))
}

fn page(store: &Store, input: &Value) -> Result<Value, String> {
    let filter = text(input, "filter").to_lowercase();
    let direction = text(input, "direction").to_lowercase();
    let order = match text(input, "sort") { "effect" => "effect_rank DESC, study_id", "pvalue" => "COALESCE(p_mlog,0) DESC, study_id", _ => "study_id" };
    let limit = input["limit"].as_i64().unwrap_or(100).clamp(1, 500);
    let offset = input["offset"].as_i64().unwrap_or(0).max(0);
    let condition = "(?1='' OR instr(lower(trait),?1)>0) AND (?2='' OR ?2='all' OR risk_level=?2)";
    let total: i64 = store.conn.query_row(&format!("SELECT count(*) FROM results WHERE {condition}"), params![filter, direction], |r| r.get(0)).map_err(sql)?;
    let page = rows(&store.conn, &format!("SELECT row FROM results WHERE {condition} ORDER BY {order} LIMIT ?3 OFFSET ?4"), params![filter, direction, limit, offset])?;
    Ok(json!({"total":total,"count":result_count(&store.conn)?,"rows":page}))
}

/// Overview report groups, streamed in the same order and grouping as `reports::partition`.
fn report_groups(store: &Store, n: usize) -> Result<Value, String> {
    if n == 0 || n > 10000 { return Err("Group count must be between 1 and 10000".into()); }
    let mut groups: Vec<(usize, Vec<String>)> = vec![(0, Vec::new()); n];
    let mut statement = store.conn.prepare("SELECT row FROM results ORDER BY abs(risk_score-1.0) DESC, study_id").map_err(sql)?;
    let mut cursor = statement.query([]).map_err(sql)?;
    let mut index = 0;
    while let Some(row) = cursor.next().map_err(sql)? {
        let value: Value = serde_json::from_str(&row.get::<_, String>(0).map_err(sql)?).map_err(|_| "Saved data is corrupt")?;
        let group = &mut groups[index % n];
        group.0 += 1;
        group.1.push(crate::reports::format_results(std::slice::from_ref(&value)));
        index += 1;
    }
    Ok(json!(groups.into_iter().map(|(count, lines)| json!({"count":count,"text":lines.join("\n")})).collect::<Vec<_>>()))
}

pub(crate) fn customization(conn: &Connection) -> Result<Value, String> {
    let mut statement = conn.prepare("SELECT field,value FROM customization").map_err(sql)?;
    let mut fields = Map::new();
    let mut context = String::new();
    for row in statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(sql)? {
        let (field, value) = row.map_err(sql)?;
        if field == CONTEXT { context = value } else { fields.insert(field, json!(value)); }
    }
    Ok(json!({"fields":fields,"context":context}))
}
/// Saves customization, stamping only the fields that changed so sync can merge per field.
fn set_customization(store: &Store, value: &Value) -> Result<Value, String> {
    crate::session::validate_customization(value)?;
    let device = meta(&store.conn, "device")?.unwrap_or_default();
    let now = now_ms();
    let mut changed = false;
    let mut entries: Vec<(String, String)> = value["fields"].as_object().into_iter().flatten().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect();
    entries.push((CONTEXT.into(), text(value, "context").into()));
    for (field, text) in entries {
        let current: Option<String> = store.conn.query_row("SELECT value FROM customization WHERE field=?1", [&field], |r| r.get(0)).optional().map_err(sql)?;
        if current.as_deref() == Some(text.as_str()) || (current.is_none() && text.is_empty()) { continue; }
        store.conn.execute("INSERT INTO customization(field,value,updated_at,device) VALUES(?1,?2,?3,?4) ON CONFLICT(field) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,device=excluded.device", params![field, text, now, device]).map_err(sql)?;
        changed = true;
    }
    if changed { touch(&store.conn, "customization")?; }
    Ok(json!(changed))
}

fn import_results(store: &Store, input: &Value) -> Result<Value, String> {
    let imported = results::import(input)?;
    let rows = array(&imported["results"]);
    results::validate_snapshot(&json!({"version":1,"results":rows}))?;
    let tx = store.conn.unchecked_transaction().map_err(sql)?;
    // As before, importing a results file replaces the saved results.
    tx.execute("DELETE FROM results", []).map_err(sql)?;
    upsert(&tx, rows, "imported")?;
    touch(&tx, "imported-results")?;
    touch(&tx, "results")?;
    tx.commit().map_err(sql)?;
    Ok(json!(rows.len()))
}

/// Unused report passes per report type.
pub(crate) fn passes(conn: &Connection) -> Result<Value, String> {
    let mut statement = conn.prepare("SELECT report_type, count(*) - (SELECT count(*) FROM report_pass_uses u WHERE u.report_type=p.report_type) FROM report_passes p GROUP BY report_type").map_err(sql)?;
    let mut out = Map::new();
    for row in statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(sql)? { let (t, n) = row.map_err(sql)?; if n > 0 { out.insert(t, json!(n)); } }
    Ok(Value::Object(out))
}
/// Credits a store transaction once. Returns whether it was new.
fn credit_pass(conn: &Connection, input: &Value) -> Result<Value, String> {
    let (id, kind) = (text(input, "transactionId"), text(input, "reportType"));
    if id.is_empty() || !["overview", "healthspan", "top_traits"].contains(&kind) { return Err("Invalid report pass".into()); }
    let added = conn.execute("INSERT OR IGNORE INTO report_passes(transaction_id,report_type) VALUES(?1,?2)", [id, kind]).map_err(sql)? > 0;
    if added { touch(conn, "report-passes")?; }
    Ok(json!(added))
}
/// Records one use of a pass for a report type. Returns whether one was available.
fn use_pass(conn: &Connection, input: &Value) -> Result<Value, String> {
    let kind = text(input, "reportType");
    if passes(conn)?[kind].as_i64().unwrap_or(0) <= 0 { return Ok(json!(false)); }
    conn.execute("INSERT INTO report_pass_uses(use_id,report_type) VALUES(?1,?2)", [hex(&random::<16>()?).as_str(), kind]).map_err(sql)?;
    touch(conn, "report-passes")?;
    Ok(json!(true))
}

pub fn dispatch(op: &str, input: &Value) -> Result<Value, String> {
    let handle = input["store"].as_u64().ok_or("Invalid store")?;
    with(handle, |store| match op {
        "store_metadata" => metadata(store),
        "store_analyze" => analyze(store, input),
        "store_results_page" => page(store, input),
        "store_result" => rows(&store.conn, "SELECT row FROM results WHERE study_id=?1", [input["studyId"].as_i64().unwrap_or(-1)]).map(|mut r| r.pop().unwrap_or(Value::Null)),
        "store_result_count" => result_count(&store.conn).map(|n| json!(n)),
        // Reports read every result once while building the prompt; nothing stays loaded afterwards.
        "store_report_prompt" => Ok(crate::reports::prompt(&json!({"kind":input["kind"],"customization":input["customization"],"context":input["context"],"results":all_rows(&store.conn)?}))),
        "store_report_groups" => report_groups(store, input["groups"].as_u64().unwrap_or(1) as usize),
        "store_export" => Ok(json!(results::export(&all_rows(&store.conn)?))),
        "store_import_results" => import_results(store, input),
        "store_customization" => customization(&store.conn),
        "store_passes" => passes(&store.conn),
        "store_pass_credit" => credit_pass(&store.conn, input),
        "store_pass_use" => use_pass(&store.conn, input),
        "store_set_customization" => set_customization(store, &input["customization"]),
        _ => Err("Unknown store operation".into()),
    })
}
