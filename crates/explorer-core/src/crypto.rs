use crate::text;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use md5::Md5;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub fn file_hash(s: &str) -> String {
    format!("{:x}", Md5::digest(s.as_bytes()))
}
fn bytes(v: &Value, key: &str) -> Result<Vec<u8>, String> {
    let s = text(v, key);
    STANDARD
        .decode(s)
        .or_else(|_| URL_SAFE_NO_PAD.decode(s))
        .map_err(|_| format!("Invalid base64 field: {key}"))
}
fn sized<const N: usize>(v: &Value, key: &str) -> Result<[u8; N], String> {
    bytes(v, key)?
        .try_into()
        .map_err(|_| format!("{key} must be {N} bytes"))
}
pub fn seal(v: &Value) -> Result<Value, String> {
    let salt = sized::<16>(v, "salt")?;
    let iv = sized::<12>(v, "iv")?;
    let iterations = v["iterations"].as_u64().unwrap_or(100000);
    if !(100000..=2000000).contains(&iterations) {
        return Err("Unsupported PBKDF2 iteration count".into());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::pbkdf2_hmac::<Sha256>(
        text(v, "password").as_bytes(),
        &salt,
        iterations as u32,
        &mut *key,
    );
    let cipher = Aes256Gcm::new_from_slice(&*key).map_err(|_| "Invalid key")?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), text(v, "plaintext").as_bytes())
        .map_err(|_| "Encryption failed")?;
    Ok(
        json!({"ciphertext":STANDARD.encode(encrypted),"iv":STANDARD.encode(iv),"salt":STANDARD.encode(salt),"iterations":iterations}),
    )
}
pub fn open(v: &Value) -> Result<Value, String> {
    let salt = sized::<16>(v, "salt")?;
    let iv = sized::<12>(v, "iv")?;
    let encrypted = bytes(v, "ciphertext")?;
    let iterations = v["iterations"].as_u64().unwrap_or(100000);
    if !(100000..=2000000).contains(&iterations) {
        return Err("Unsupported PBKDF2 iteration count".into());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::pbkdf2_hmac::<Sha256>(
        text(v, "password").as_bytes(),
        &salt,
        iterations as u32,
        &mut *key,
    );
    let cipher = Aes256Gcm::new_from_slice(&*key).map_err(|_| "Invalid key")?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&iv), encrypted.as_slice())
        .map_err(|_| "Decryption failed - incorrect password")?;
    Ok(json!(
        String::from_utf8(plain).map_err(|_| "Invalid plaintext encoding")?
    ))
}
pub fn auth_keypair(v: &Value) -> Result<Value, String> {
    let secret = x25519_dalek::StaticSecret::from(sized::<32>(v, "entropy")?);
    let public = x25519_dalek::PublicKey::from(&secret);
    Ok(
        json!({"privateKey":URL_SAFE_NO_PAD.encode(secret.to_bytes()),"publicKey":URL_SAFE_NO_PAD.encode(public.as_bytes())}),
    )
}
fn auth_key(
    secret: &x25519_dalek::StaticSecret,
    public: [u8; 32],
) -> Result<Zeroizing<[u8; 32]>, String> {
    let shared = secret.diffie_hellman(&x25519_dalek::PublicKey::from(public));
    if !shared.was_contributory() {
        return Err("Invalid auth public key".into());
    }
    let mut hash = Sha256::new();
    hash.update(b"Monadic DNA mobile auth v1");
    hash.update(shared.as_bytes());
    Ok(Zeroizing::new(hash.finalize().into()))
}
pub fn auth_seal(v: &Value) -> Result<Value, String> {
    let secret = x25519_dalek::StaticSecret::from(sized::<32>(v, "entropy")?);
    let public = x25519_dalek::PublicKey::from(&secret);
    let key = auth_key(&secret, sized::<32>(v, "publicKey")?)?;
    let nonce = sized::<12>(v, "iv")?;
    let cipher = Aes256Gcm::new_from_slice(&*key).map_err(|_| "Invalid key")?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: text(v, "plaintext").as_bytes(),
                aad: text(v, "state").as_bytes(),
            },
        )
        .map_err(|_| "Auth encryption failed")?;
    Ok(
        json!({"publicKey":URL_SAFE_NO_PAD.encode(public.as_bytes()),"iv":URL_SAFE_NO_PAD.encode(nonce),"ciphertext":URL_SAFE_NO_PAD.encode(ciphertext)}),
    )
}
pub fn auth_open(v: &Value) -> Result<Value, String> {
    let secret = x25519_dalek::StaticSecret::from(sized::<32>(v, "privateKey")?);
    let key = auth_key(&secret, sized::<32>(v, "publicKey")?)?;
    let nonce = sized::<12>(v, "iv")?;
    let encrypted = bytes(v, "ciphertext")?;
    let cipher = Aes256Gcm::new_from_slice(&*key).map_err(|_| "Invalid key")?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &encrypted,
                aad: text(v, "state").as_bytes(),
            },
        )
        .map_err(|_| "Auth response rejected")?;
    Ok(json!(
        String::from_utf8(plain).map_err(|_| "Invalid auth response")?
    ))
}
