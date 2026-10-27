//! Research catalog snapshots bundled with native app releases for Run all.
//! scripts/catalog-snapshot.mjs writes the format; hosts read it in chunks so they
//! can report progress and cancel between chunks.
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

const STUDY_COLUMNS: [&str; 4] = ["study_accession", "study", "initial_sample_size", "replication_sample_size"];
const ROW_COLUMNS: [&str; 9] = ["id", "snps", "strongest_snp_risk_allele", "or_or_beta", "ci_text", "disease_trait", "p_value", "pvalue_mlog", "mapped_gene"];
const ALLELE_COLUMN: usize = 2; // strongest_snp_risk_allele

type Reader = BufReader<ruzstd::decoding::StreamingDecoder<Box<dyn Read + Send>, ruzstd::decoding::FrameDecoder>>;
// `matched` lets a complete run drop saved results the current catalog no longer produces.
struct Catalog { reader: Reader, studies: Vec<Vec<String>>, version: String, matched: HashSet<i64>, done: bool }

static CATALOGS: OnceLock<Mutex<HashMap<u64, Catalog>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
fn catalogs() -> std::sync::MutexGuard<'static, HashMap<u64, Catalog>> {
    CATALOGS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

fn line(reader: &mut Reader) -> Result<Option<String>, String> {
    let mut text = String::new();
    match reader.read_line(&mut text) {
        Ok(0) => Ok(None),
        Ok(_) => { if text.ends_with('\n') { text.pop(); } Ok(Some(text)) }
        Err(_) => Err("The bundled research catalog is corrupt".into()),
    }
}
fn expect_section(reader: &mut Reader, name: &str, columns: &[&str]) -> Result<(), String> {
    let header = line(reader)?.ok_or("The bundled research catalog is truncated")?;
    let mut fields = header.split('\t');
    if fields.next() != Some(name) || !fields.by_ref().take(columns.len()).eq(columns.iter().copied()) {
        return Err("The bundled research catalog has an unexpected layout".into());
    }
    Ok(())
}

/// Opens a compressed snapshot file and reads its study table. Rows are matched later in chunks.
/// Streaming from disk keeps the snapshot out of host memory.
pub fn open(path: &str) -> Result<Value, String> {
    let file = std::fs::File::open(path).map_err(|_| "The bundled research catalog is missing")?;
    let source: Box<dyn Read + Send> = Box::new(BufReader::new(file));
    let decoder = ruzstd::decoding::StreamingDecoder::new(source).map_err(|_| "The bundled research catalog is not a valid snapshot")?;
    let mut reader = BufReader::with_capacity(1 << 20, decoder);
    let header = line(&mut reader)?.ok_or("The bundled research catalog is empty")?;
    let fields: Vec<&str> = header.split('\t').collect();
    if fields.len() != 5 || fields[0] != "EXPLORER-CATALOG" { return Err("The bundled research catalog is not a valid snapshot".into()); }
    if fields[1] != "1" { return Err("This app does not support the bundled catalog format".into()); }
    let (version, rows) = (fields[2].to_string(), fields[3].parse::<u64>().map_err(|_| "Invalid catalog header")?);
    let count = fields[4].parse::<usize>().map_err(|_| "Invalid catalog header")?;
    expect_section(&mut reader, "#studies", &STUDY_COLUMNS)?;
    let mut studies = Vec::with_capacity(count);
    for _ in 0..count {
        let record = line(&mut reader)?.ok_or("The bundled research catalog is truncated")?;
        let values: Vec<String> = record.split('\t').map(str::to_string).collect();
        if values.len() != STUDY_COLUMNS.len() { return Err("The bundled research catalog is corrupt".into()); }
        studies.push(values);
    }
    expect_section(&mut reader, "#rows", &ROW_COLUMNS)?;
    let handle = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    catalogs().insert(handle, Catalog { reader, studies, version: version.clone(), matched: HashSet::new(), done: false });
    Ok(json!({"handle":handle,"version":version,"rows":rows,"studies":count}))
}

/// Matches up to `max_rows` further catalog rows into the session and returns counts.
/// Matches up to `max_rows` further catalog rows into the store and returns counts.
pub fn analyze_next(handle: u64, store: u64, max_rows: usize, now: &str) -> Result<Value, String> {
    let mut all = catalogs();
    let catalog = all.get_mut(&handle).ok_or("The research catalog is closed")?;
    let mut lines = Vec::with_capacity(max_rows.min(100_000));
    while lines.len() < max_rows && !catalog.done {
        match line(&mut catalog.reader)? { Some(record) if !record.is_empty() => lines.push(record), Some(_) => {}, None => catalog.done = true }
    }
    let count = lines.len();
    // Most rows cannot match this person's DNA; skip them before building JSON, using the scorer's own rule.
    crate::store::with(store, |db| {
    let candidates: Vec<String> = crate::store::with_genotypes(db, |genotypes| {
        lines.into_iter().filter(|record| record.split('\t').nth(ALLELE_COLUMN).is_some_and(|allele| crate::analysis::strict_candidate(allele, crate::analysis::Genotypes::Session(genotypes)).is_some())).collect()
    })?;
    let mut rows = Vec::with_capacity(candidates.len());
    for record in &candidates {
        let values: Vec<&str> = record.split('\t').collect();
        if values.len() != ROW_COLUMNS.len() + 1 { return Err("The bundled research catalog is corrupt".into()); }
        let study = values[ROW_COLUMNS.len()].parse::<usize>().ok().and_then(|i| catalog.studies.get(i)).ok_or("The bundled research catalog is corrupt")?;
        // Same shape as the catalog API's Run all rows: numeric id, null for empty text.
        let mut row = Map::with_capacity(ROW_COLUMNS.len() + STUDY_COLUMNS.len());
        row.insert("id".into(), json!(values[0].parse::<i64>().map_err(|_| "The bundled research catalog is corrupt")?));
        let text = |value: &str| if value.is_empty() { Value::Null } else { Value::String(value.to_string()) };
        for (key, value) in ROW_COLUMNS.iter().zip(&values).skip(1) { row.insert((*key).into(), text(value)); }
        for (key, value) in STUDY_COLUMNS.iter().zip(study) { row.insert((*key).into(), text(value)); }
        rows.push(Value::Object(row));
    }
    let matches = crate::store::with_genotypes(db, |genotypes| crate::analysis::run(&rows, crate::analysis::Genotypes::Session(genotypes), true, now, true))?;
    let tx = db.conn.unchecked_transaction().map_err(crate::store::sql)?;
    crate::store::upsert(&tx, &matches, "catalog")?;
    catalog.matched.extend(matches.iter().filter_map(|row| row["studyId"].as_i64()));
    if catalog.done {
        // The whole catalog was matched, so catalog results it did not produce are stale.
        tx.execute_batch("CREATE TEMP TABLE IF NOT EXISTS run_matched(study_id INTEGER PRIMARY KEY); DELETE FROM run_matched;").map_err(crate::store::sql)?;
        {
            let mut keep = tx.prepare("INSERT OR IGNORE INTO run_matched(study_id) VALUES(?1)").map_err(crate::store::sql)?;
            for id in &catalog.matched { keep.execute([id]).map_err(crate::store::sql)?; }
        }
        tx.execute("DELETE FROM results WHERE source='catalog' AND study_id NOT IN (SELECT study_id FROM run_matched)", []).map_err(crate::store::sql)?;
        crate::store::set_meta(&tx, "catalogVersion", &catalog.version)?;
        crate::store::touch(&tx, "results")?;
    }
    tx.commit().map_err(crate::store::sql)?;
    if catalog.done { crate::store::release_genotypes(db); }
    // Hosts read results through store queries, so only counts cross the boundary.
    Ok(json!({"rows":count,"matched":matches.len(),"saved":crate::store::result_count(&db.conn)?,"done":catalog.done}))
    })
}

pub fn close(handle: u64) { catalogs().remove(&handle); }
