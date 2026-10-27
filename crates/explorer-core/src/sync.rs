//! End-to-end encrypted sync of the native store (docs/native-data-store.md).
//! The core builds signed requests and encrypted records; hosts do the HTTP.
use crate::store::{self, hex, meta, now_ms, random, set_meta, sql, Store};
use crate::text;
use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use crate::sync_auth::{account_id, message};
use k256::ecdsa::{signature::Signer, Signature, SigningKey};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use zeroize::Zeroizing;

pub const RECORDS: [&str; 4] = ["genotype", "results", "customization", "imported-results"];
const MAX_PLAINTEXT: u64 = 256 * 1024 * 1024;

struct Keys { records: Zeroizing<Vec<u8>>, signing: SigningKey, account: String, public_key: String }
fn keys(conn: &Connection) -> Result<Keys, String> {
    let encoded = Zeroizing::new(meta(conn, "syncKey")?.ok_or("Sync is not set up")?);
    let key = Zeroizing::new(STANDARD.decode(encoded.as_bytes()).map_err(|_| "Invalid sync key")?);
    let records = crate::vault::domain_key(&key, b"monadic-dna/explorer/sync/records/v1")?;
    let auth = crate::vault::domain_key(&key, b"monadic-dna/explorer/sync/auth/v1")?;
    let signing = SigningKey::from_slice(&auth).map_err(|_| "Invalid sync key")?;
    let public = signing.verifying_key().to_encoded_point(true);
    Ok(Keys { records, account: account_id(public.as_bytes()), public_key: hex(public.as_bytes()), signing })
}
fn aad(account: &str, record: &str, revision: i64) -> String { format!("monadic-dna/explorer/sync/record/v1|{account}|{record}|{revision}") }

fn state(conn: &Connection, record: &str) -> Result<(i64, i64, i64, Option<String>), String> {
    Ok(conn.query_row("SELECT revision,version,synced_version,hash FROM sync_state WHERE record=?1", [record], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().map_err(sql)?.unwrap_or((0, 0, 0, None)))
}
fn set_revision(conn: &Connection, record: &str, revision: i64, synced_version: Option<i64>, hash: Option<&str>) -> Result<(), String> {
    conn.execute("INSERT INTO sync_state(record,revision) VALUES(?1,?2) ON CONFLICT(record) DO UPDATE SET revision=excluded.revision", params![record, revision]).map_err(sql)?;
    if let Some(version) = synced_version { conn.execute("UPDATE sync_state SET synced_version=?2 WHERE record=?1", params![record, version]).map_err(sql)?; }
    if let Some(hash) = hash { conn.execute("UPDATE sync_state SET hash=?2 WHERE record=?1", params![record, hash]).map_err(sql)?; }
    Ok(())
}
fn enabled(conn: &Connection) -> Result<bool, String> { Ok(meta(conn, "syncEnabled")?.as_deref() == Some("1")) }

fn status(store: &Store) -> Result<Value, String> {
    if !enabled(&store.conn)? { return Ok(json!({"enabled":false})); }
    let keys = keys(&store.conn)?;
    Ok(json!({"enabled":true,"account":keys.account,"publicKey":keys.public_key}))
}
/// Turns sync on with a sync key restored from the platform's secret store, or a new one.
/// Returns the key so the host can store it in iCloud Keychain or Block Store.
fn enable(store: &Store, input: &Value) -> Result<Value, String> {
    let key = match input["syncKey"].as_str().filter(|k| !k.is_empty()) {
        Some(existing) => { let bytes = Zeroizing::new(STANDARD.decode(existing).map_err(|_| "Invalid sync key")?); if bytes.len() != 32 { return Err("Invalid sync key".into()); } existing.to_string() }
        None => STANDARD.encode(Zeroizing::new(random::<32>()?).as_slice()),
    };
    set_meta(&store.conn, "syncKey", &key)?;
    set_meta(&store.conn, "syncEnabled", "1")?;
    // Upload what exists locally; a fresh device restoring from the cloud has nothing to send yet.
    for record in RECORDS { if has_local(&store.conn, record)? { store::touch(&store.conn, record)?; } }
    let keys = keys(&store.conn)?;
    Ok(json!({"syncKey":key,"account":keys.account}))
}
fn disable(store: &Store) -> Result<Value, String> {
    store.conn.execute("DELETE FROM meta WHERE key IN ('syncKey','syncEnabled')", []).map_err(sql)?;
    store.conn.execute("DELETE FROM sync_state", []).map_err(sql)?;
    Ok(Value::Null)
}
fn has_local(conn: &Connection, record: &str) -> Result<bool, String> {
    let query = match record {
        "genotype" => "SELECT EXISTS(SELECT 1 FROM genotypes)",
        "results" => "SELECT EXISTS(SELECT 1 FROM results WHERE source='catalog')",
        "customization" => "SELECT EXISTS(SELECT 1 FROM customization)",
        _ => "SELECT EXISTS(SELECT 1 FROM results WHERE source='imported')",
    };
    conn.query_row(query, [], |r| r.get(0)).map_err(sql)
}

/// Signs a request body. The server rebuilds the message and checks it with `sync_verify`.
fn sign(store: &Store, input: &Value) -> Result<Value, String> {
    let keys = keys(&store.conn)?;
    let timestamp = (now_ms() / 1000).to_string();
    let nonce = hex(&random::<16>()?);
    let signature: Signature = keys.signing.sign(message(&timestamp, &nonce, text(input, "body")).as_bytes());
    Ok(json!({"account":keys.account,"publicKey":keys.public_key,"timestamp":timestamp,"nonce":nonce,"signature":hex(&signature.to_bytes())}))
}
/// Server records newer than what this device has applied, in `RECORDS` order: genotypes come
/// first because synced results are only used when they match the device's DNA file.
fn wanted(store: &Store, input: &Value) -> Result<Value, String> {
    let entries = crate::array(&input["records"]);
    let mut names = Vec::new();
    for record in RECORDS {
        let remote = entries.iter().find(|e| text(e, "record") == record).and_then(|e| e["revision"].as_i64()).unwrap_or(0);
        if remote > state(&store.conn, record)?.0 { names.push(record.to_string()); }
    }
    Ok(json!(names))
}

// Record payloads are gzip-compressed, newline-separated: one JSON header line, then one line per item.
// Line framing lets large records stream in and out of the database without a full in-memory copy.
fn payload(conn: &Connection, record: &str) -> Result<(Zeroizing<Vec<u8>>, String), String> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    let mut hasher = Sha256::new();
    let mut line = |gz: &mut GzEncoder<Vec<u8>>, text: &str| -> Result<(), String> {
        hasher.update(text.as_bytes()); hasher.update(b"\n");
        gz.write_all(text.as_bytes()).and_then(|_| gz.write_all(b"\n")).map_err(|_| "Unable to prepare sync data".to_string())
    };
    match record {
        "genotype" => {
            let mut header = store_meta(conn, &["detectedFormat", "fileHash", "fileName", "importedAt"])?;
            header["kind"] = json!("genotype");
            line(&mut gz, &header.to_string())?;
            let mut statement = conn.prepare("SELECT rsid,call FROM genotypes ORDER BY rsid").map_err(sql)?;
            let mut cursor = statement.query([]).map_err(sql)?;
            while let Some(row) = cursor.next().map_err(sql)? {
                let text = Zeroizing::new(format!("{}\t{}", row.get::<_, String>(0).map_err(sql)?, row.get::<_, String>(1).map_err(sql)?));
                line(&mut gz, &text)?;
            }
        }
        "results" | "imported-results" => {
            let source = if record == "results" { "catalog" } else { "imported" };
            let header = json!({"kind":record,"catalogVersion":meta(conn, "catalogVersion")?,"genotypeDigest":meta(conn, "fileHash")?});
            line(&mut gz, &header.to_string())?;
            let mut statement = conn.prepare("SELECT row FROM results WHERE source=?1 ORDER BY study_id").map_err(sql)?;
            let mut cursor = statement.query([source]).map_err(sql)?;
            while let Some(row) = cursor.next().map_err(sql)? { line(&mut gz, &Zeroizing::new(row.get::<_, String>(0).map_err(sql)?))?; }
        }
        _ => {
            line(&mut gz, &json!({"kind":"customization"}).to_string())?;
            let mut statement = conn.prepare("SELECT field,value,updated_at,device FROM customization ORDER BY field").map_err(sql)?;
            let mut cursor = statement.query([]).map_err(sql)?;
            while let Some(row) = cursor.next().map_err(sql)? {
                let entry = json!({"field":row.get::<_, String>(0).map_err(sql)?,"value":row.get::<_, String>(1).map_err(sql)?,"updatedAt":row.get::<_, i64>(2).map_err(sql)?,"device":row.get::<_, String>(3).map_err(sql)?});
                line(&mut gz, &Zeroizing::new(entry.to_string()))?;
            }
        }
    }
    let compressed = Zeroizing::new(gz.finish().map_err(|_| "Unable to prepare sync data")?);
    Ok((compressed, hex(&hasher.finalize())))
}
fn store_meta(conn: &Connection, keys: &[&str]) -> Result<Value, String> {
    let mut value = json!({});
    for key in keys { if let Some(v) = meta(conn, key)? { value[*key] = json!(v); } }
    Ok(value)
}

/// Encrypted records with local changes not yet uploaded. Unchanged results (same content hash) are skipped.
fn outgoing(store: &Store) -> Result<Value, String> {
    if !enabled(&store.conn)? { return Ok(json!([])); }
    let keys = keys(&store.conn)?;
    let mut out = Vec::new();
    for record in RECORDS {
        let (revision, version, synced, hash) = state(&store.conn, record)?;
        if version <= synced { continue; }
        let (compressed, digest) = payload(&store.conn, record)?;
        if hash.as_deref() == Some(digest.as_str()) {
            store.conn.execute("UPDATE sync_state SET synced_version=?2 WHERE record=?1", params![record, version]).map_err(sql)?;
            continue;
        }
        let cipher = Aes256Gcm::new_from_slice(&keys.records).map_err(|_| "Invalid sync key")?;
        let nonce = random::<12>()?;
        let associated = aad(&keys.account, record, revision + 1);
        let sealed = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: &compressed, aad: associated.as_bytes() }).map_err(|_| "Unable to encrypt sync data")?;
        let mut blob = nonce.to_vec(); blob.extend(sealed);
        out.push(json!({"record":record,"baseRevision":revision,"version":version,"hash":digest,"ciphertext":STANDARD.encode(blob)}));
    }
    Ok(json!(out))
}
/// Called after the server accepted an upload.
fn pushed(store: &Store, input: &Value) -> Result<Value, String> {
    let record = text(input, "record");
    if !RECORDS.contains(&record) { return Err("Unknown sync record".into()); }
    set_revision(&store.conn, record, input["revision"].as_i64().ok_or("Invalid revision")?, input["version"].as_i64(), Some(text(input, "hash")))?;
    Ok(Value::Null)
}

fn open_record(keys: &Keys, record: &str, revision: i64, ciphertext: &str) -> Result<Vec<String>, String> {
    let blob = STANDARD.decode(ciphertext).map_err(|_| "Invalid sync data")?;
    if blob.len() < 28 { return Err("Invalid sync data".into()); }
    let cipher = Aes256Gcm::new_from_slice(&keys.records).map_err(|_| "Invalid sync key")?;
    let associated = aad(&keys.account, record, revision);
    let compressed = Zeroizing::new(cipher.decrypt(Nonce::from_slice(&blob[..12]), Payload { msg: &blob[12..], aad: associated.as_bytes() }).map_err(|_| "Sync data failed authentication")?);
    let reader = BufReader::new(GzDecoder::new(compressed.as_slice()).take(MAX_PLAINTEXT));
    reader.lines().map(|l| l.map_err(|_| "Invalid sync data".to_string())).collect()
}

/// Decrypts a server record and merges it into the store. Returns what changed so the host can refresh
/// and, when synced results do not match this device's catalog, run the catalog match.
fn apply(store: &mut Store, input: &Value) -> Result<Value, String> {
    let record = text(input, "record");
    if !RECORDS.contains(&record) { return Err("Unknown sync record".into()); }
    let revision = input["revision"].as_i64().ok_or("Invalid revision")?;
    let keys = keys(&store.conn)?;
    let lines = open_record(&keys, record, revision, text(input, "ciphertext"))?;
    let header: Value = serde_json::from_str(lines.first().ok_or("Invalid sync data")?).map_err(|_| "Invalid sync data")?;
    let (_, version, synced, _) = state(&store.conn, record)?;
    let local_changed = version > synced;
    let tx = store.conn.unchecked_transaction().map_err(sql)?;
    let mut changed = false;
    match record {
        "genotype" => {
            // The most recent import wins.
            let remote: i64 = text(&header, "importedAt").parse().unwrap_or(0);
            let local: i64 = meta(&tx, "importedAt")?.and_then(|v| v.parse().ok()).unwrap_or(0);
            let replaced_local = local > 0 && meta(&tx, "fileHash")?.as_deref() != header["fileHash"].as_str();
            if remote >= local {
                tx.execute("DELETE FROM genotypes", []).map_err(sql)?;
                {
                    let mut insert = tx.prepare("INSERT OR REPLACE INTO genotypes(rsid,call) VALUES(?1,?2)").map_err(sql)?;
                    for item in &lines[1..] { if let Some((rsid, call)) = item.split_once('\t') { insert.execute(params![rsid, call]).map_err(sql)?; } }
                }
                for key in ["detectedFormat", "fileHash", "fileName", "importedAt"] { if let Some(v) = header[key].as_str() { set_meta(&tx, key, v)?; } }
                if replaced_local { tx.execute("DELETE FROM results WHERE source='catalog'", []).map_err(sql)?; }
                set_revision(&tx, record, revision, Some(version), None)?;
                tx.commit().map_err(sql)?;
                store::release_genotypes(store);
                return Ok(json!({"record":record,"changed":true,"replacedLocal":replaced_local}));
            }
            // This device's import is newer; keep it and overwrite the server copy.
            set_revision(&tx, record, revision, None, None)?;
            if !local_changed { store::touch(&tx, record)?; }
        }
        "results" => {
            // Use synced results only when they were computed from this DNA file with this device's catalog.
            let matches = header["genotypeDigest"] == json!(meta(&tx, "fileHash")?) && header["catalogVersion"].as_str() == input["catalogVersion"].as_str();
            if matches && !local_changed {
                tx.execute("DELETE FROM results WHERE source='catalog'", []).map_err(sql)?;
                let rows: Vec<Value> = lines[1..].iter().map(|l| serde_json::from_str(l).map_err(|_| "Invalid sync data".to_string())).collect::<Result<_, _>>()?;
                store::upsert(&tx, &rows, "catalog")?;
                if let Some(v) = header["catalogVersion"].as_str() { set_meta(&tx, "catalogVersion", v)?; }
                changed = true;
                set_revision(&tx, record, revision, Some(version), None)?;
            } else {
                set_revision(&tx, record, revision, None, None)?;
            }
        }
        "customization" => {
            // Per-field merge: the newest edit of each field wins.
            let mut local_newer = false;
            let mut seen = std::collections::HashSet::new();
            for item in &lines[1..] {
                let entry: Value = serde_json::from_str(item).map_err(|_| "Invalid sync data")?;
                let field = text(&entry, "field");
                seen.insert(field.to_string());
                let updated = entry["updatedAt"].as_i64().unwrap_or(0);
                let current: Option<i64> = tx.query_row("SELECT updated_at FROM customization WHERE field=?1", [field], |r| r.get(0)).optional().map_err(sql)?;
                match current {
                    Some(local) if local > updated => local_newer = true,
                    Some(local) if local == updated => {}
                    _ => { tx.execute("INSERT INTO customization(field,value,updated_at,device) VALUES(?1,?2,?3,?4) ON CONFLICT(field) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,device=excluded.device", params![field, text(&entry, "value"), updated, text(&entry, "device")]).map_err(sql)?; changed = true; }
                }
            }
            let local_only: i64 = { let mut s = tx.prepare("SELECT field FROM customization").map_err(sql)?; let fields: Vec<String> = s.query_map([], |r| r.get(0)).map_err(sql)?.collect::<Result<_, _>>().map_err(sql)?; fields.iter().filter(|f| !seen.contains(*f)).count() as i64 };
            set_revision(&tx, record, revision, if local_newer || local_only > 0 { None } else { Some(version) }, None)?;
            if (local_newer || local_only > 0) && !local_changed { store::touch(&tx, record)?; }
        }
        _ => {
            if !local_changed {
                tx.execute("DELETE FROM results WHERE source='imported'", []).map_err(sql)?;
                let rows: Vec<Value> = lines[1..].iter().map(|l| serde_json::from_str(l).map_err(|_| "Invalid sync data".to_string())).collect::<Result<_, _>>()?;
                store::upsert(&tx, &rows, "imported")?;
                changed = true;
                set_revision(&tx, record, revision, Some(version), None)?;
            } else {
                set_revision(&tx, record, revision, None, None)?;
            }
        }
    }
    tx.commit().map_err(sql)?;
    Ok(json!({"record":record,"changed":changed}))
}

/// Whether this device needs to run the catalog match: it has DNA but no results for its catalog and DNA file.
fn needs_match(store: &Store, input: &Value) -> Result<Value, String> {
    let has_dna: bool = store.conn.query_row("SELECT EXISTS(SELECT 1 FROM genotypes)", [], |r| r.get(0)).map_err(sql)?;
    let has_results = store.conn.query_row("SELECT EXISTS(SELECT 1 FROM results WHERE source='catalog')", [], |r| r.get::<_, bool>(0)).map_err(sql)?;
    let current = meta(&store.conn, "catalogVersion")?.as_deref() == input["catalogVersion"].as_str();
    Ok(json!(has_dna && (!has_results || !current)))
}

pub fn dispatch(op: &str, input: &Value) -> Result<Value, String> {
    let handle = input["store"].as_u64().ok_or("Invalid store")?;
    store::with(handle, |store| match op {
        "store_sync_status" => status(store),
        "store_sync_enable" => enable(store, input),
        "store_sync_disable" => disable(store),
        "store_sync_sign" => sign(store, input),
        "store_sync_wanted" => wanted(store, input),
        "store_sync_outgoing" => outgoing(store),
        "store_sync_pushed" => pushed(store, input),
        "store_sync_apply" => apply(store, input),
        "store_needs_match" => needs_match(store, input),
        _ => Err("Unknown sync operation".into()),
    })
}
