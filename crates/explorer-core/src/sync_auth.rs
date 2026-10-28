//! Helpers for sync record keys. Records are stored in the user's own iCloud or Google Drive, never on the Monadic DNA backend.
use sha2::{Digest, Sha256};

pub(crate) fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }
/// Identifies a user's sync data: the SHA-256 of a public key derived from their sync key. Bound into each record's associated data.
pub(crate) fn account_id(public_key: &[u8]) -> String { hex(&Sha256::digest(public_key)) }
