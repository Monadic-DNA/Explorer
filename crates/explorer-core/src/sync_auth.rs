//! Sync request signing, shared by native clients and the web server's WASM build.
use crate::text;
use k256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub(crate) fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }
fn unhex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 || s.len() > 256 { return Err("Invalid hex".into()); }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "Invalid hex".to_string())).collect()
}
/// The account ID is the SHA-256 of the compressed signing public key.
pub(crate) fn account_id(public_key: &[u8]) -> String { hex(&Sha256::digest(public_key)) }
/// What a sync request signs: its timestamp, a random nonce and the SHA-256 of the exact body.
pub(crate) fn message(timestamp: &str, nonce: &str, body: &str) -> String {
    format!("monadic-dna/explorer/sync/v1\n{timestamp}\n{nonce}\n{}", hex(&Sha256::digest(body.as_bytes())))
}
/// Server-side check of a signed sync request; returns the account the key belongs to.
pub fn verify(input: &Value) -> Result<Value, String> {
    let public = unhex(text(input, "publicKey"))?;
    let key = VerifyingKey::from_sec1_bytes(&public).map_err(|_| "Invalid sync public key")?;
    let signature = Signature::from_slice(&unhex(text(input, "signature"))?).map_err(|_| "Invalid sync signature")?;
    let valid = key.verify(message(text(input, "timestamp"), text(input, "nonce"), text(input, "body")).as_bytes(), &signature).is_ok();
    Ok(json!({"valid":valid,"account":account_id(&public)}))
}
