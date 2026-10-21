//! NUC ES256K authentication, interoperable with @nillion/nuc.
//! Hosts supply CSPRNG nonces, time, HTTP transport and OS-bound key storage.
use crate::text;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use k256::ecdsa::{
    signature::{Signer, Verifier},
    Signature, SigningKey, VerifyingKey,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if !s.is_ascii() || s.len() % 2 != 0 {
        return Err("Invalid NUC key".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "Invalid NUC key".into()))
        .collect()
}
fn key(s: &str) -> Result<SigningKey, String> {
    let raw = Zeroizing::new(unhex(s)?);
    SigningKey::from_slice(&raw).map_err(|_| "Invalid nilAI private key".into())
}
fn parse(token: &str) -> Result<Value, String> {
    let parts = token.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err("Invalid NUC token".into());
    }
    let header: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(parts[0])
            .map_err(|_| "Invalid NUC header")?,
    )
    .map_err(|_| "Invalid NUC header")?;
    if header["alg"] != "ES256K" {
        return Err("Unsupported NUC signature algorithm".into());
    }
    let body: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| "Invalid NUC payload")?,
    )
    .map_err(|_| "Invalid NUC payload")?;
    let issuer = text(&body, "iss")
        .strip_prefix("did:nil:")
        .ok_or("Invalid NUC issuer")?;
    let verify =
        VerifyingKey::from_sec1_bytes(&unhex(issuer)?).map_err(|_| "Invalid NUC issuer key")?;
    let signature = Signature::from_slice(
        &URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| "Invalid NUC signature")?,
    )
    .map_err(|_| "Invalid NUC signature")?;
    verify
        .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .map_err(|_| "NUC signature verification failed")?;
    Ok(body)
}
fn sign(payload: &Value, key: &SigningKey) -> String {
    let message = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(br#"{"alg":"ES256K"}"#),
        URL_SAFE_NO_PAD.encode(payload.to_string())
    );
    let signature: Signature = key.sign(message.as_bytes());
    format!("{message}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()))
}
pub fn keypair(v: &Value) -> Result<Value, String> {
    let bytes = Zeroizing::new(
        STANDARD
            .decode(text(v, "entropy"))
            .map_err(|_| "Invalid entropy")?,
    );
    let key = SigningKey::from_slice(&bytes).map_err(|_| "Invalid entropy for secp256k1")?;
    Ok(
        json!({"privateKey":hex(&key.to_bytes()),"publicKey":hex(key.verifying_key().to_encoded_point(true).as_bytes())}),
    )
}
pub fn info(v: &Value) -> Result<Value, String> {
    let parts = v.as_str().unwrap_or("").split('/').collect::<Vec<_>>();
    let body = parse(parts[0])?;
    let mut expires = u64::MAX;
    for token in &parts {
        let p = parse(token)?;
        if let Some(exp) = p["exp"].as_u64() {
            expires = expires.min(exp);
        }
    }
    Ok(json!({"expiresAt":expires,"audience":body["aud"]}))
}
pub fn invocation(v: &Value) -> Result<Value, String> {
    let signing = key(text(v, "privateKey"))?;
    let did = format!(
        "did:nil:{}",
        hex(signing.verifying_key().to_encoded_point(true).as_bytes())
    );
    let public = STANDARD
        .decode(text(v, "serverKey").trim())
        .map_err(|_| "Invalid nilAI server key")?;
    VerifyingKey::from_sec1_bytes(&public).map_err(|_| "Invalid nilAI server key")?;
    let server_did = format!("did:nil:{}", hex(&public));
    let now = v["now"].as_u64().ok_or("Current time is required")?;
    let nonce = STANDARD
        .decode(text(v, "nonce"))
        .map_err(|_| "Invalid nonce")?;
    if nonce.len() != 16 {
        return Err("Nonce must be 16 bytes".into());
    }
    let proof = if text(v, "delegation").is_empty() {
        let root_nonce = STANDARD
            .decode(text(v, "rootNonce"))
            .map_err(|_| "Invalid root nonce")?;
        if root_nonce.len() != 16 {
            return Err("Root nonce must be 16 bytes".into());
        }
        let expires = now.checked_add(3600).ok_or("Invalid timestamp")?;
        sign(
            &json!({"iss":did,"aud":did,"sub":did,"exp":expires,"cmd":"/nil/ai/generate","pol":[],"nonce":hex(&root_nonce)}),
            &signing,
        )
    } else {
        text(v, "delegation").into()
    };
    let tokens = proof.split('/').collect::<Vec<_>>();
    let body = parse(tokens[0])?;
    if body["aud"] != did || body["cmd"] != "/nil/ai/generate" || !body["pol"].is_array() {
        return Err("Delegation does not authorize this device".into());
    }
    for token in &tokens {
        let p = parse(token)?;
        if p["exp"].as_u64().is_some_and(|exp| exp <= now)
            || p["nbf"].as_u64().is_some_and(|nbf| nbf > now)
        {
            return Err("NUC delegation expired or not yet valid".into());
        }
    }
    let invocation = sign(
        &json!({"iss":did,"aud":server_did,"sub":body["sub"],"cmd":"/nil/ai/generate","args":{},"nonce":hex(&nonce),"prf":[hex(&Sha256::digest(tokens[0].as_bytes()))]}),
        &signing,
    );
    Ok(json!(format!("{invocation}/{proof}")))
}
