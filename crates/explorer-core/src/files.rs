use crate::text;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::io::Read;
pub fn decode(v: &Value) -> Result<String, String> {
    let bytes = STANDARD
        .decode(text(v, "bytes"))
        .map_err(|_| "Invalid file bytes")?;
    decode_bytes(bytes)
}
pub fn decode_bytes(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > 150 * 1024 * 1024 {
        return Err("File exceeds 150 MB".into());
    }
    let decoded = if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        let mut remaining = bytes.as_slice();
        loop {
            if !remaining.starts_with(&[0x1f, 0x8b]) {
                // Some provider exports append small garbage trailers. Preserve
                // web compatibility without repeatedly inflating the whole file.
                if remaining.len() <= 16 * 1024 {
                    break;
                }
                return Err("Invalid gzip trailer".into());
            }
            let limit = 250 * 1024 * 1024 + 1 - out.len();
            let mut decoder = flate2::bufread::GzDecoder::new(remaining);
            decoder
                .by_ref()
                .take(limit as u64)
                .read_to_end(&mut out)
                .map_err(|_| "Invalid gzip file")?;
            if out.len() > 250 * 1024 * 1024 {
                return Err("Expanded file exceeds 250 MB".into());
            }
            remaining = decoder.into_inner();
            if remaining.is_empty() {
                break;
            }
        }
        out
    } else {
        bytes
    };
    String::from_utf8(decoded).map_err(|_| "File is not valid UTF-8".into())
}
