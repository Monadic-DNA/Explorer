//! Versioned, authenticated and compressed vault format shared by WASM and native clients.
use crate::text;
use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::{write::GzEncoder, read::GzDecoder, Compression};
use serde_json::{json, Value};
use std::io::{Read, Write};
use zeroize::Zeroizing;

const MAX: usize = 256 * 1024 * 1024;
fn bytes(v: &Value, name: &str, len: usize) -> Result<Vec<u8>, String> {
    let value = STANDARD.decode(text(v,name)).map_err(|_| "Invalid vault bytes")?;
    if len > 0 && value.len()!=len { return Err("Invalid vault byte length".into()); }
    Ok(value)
}
fn identity(id: &str) -> Result<(), String> {
    if id.len()!=36 || !id.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) {c==b'-'} else {c.is_ascii_hexdigit()}) { return Err("Invalid vault identity".into()); }
    Ok(())
}
fn aad(v: &Value) -> Result<String,String> {
    let id=text(v,"vaultId"); identity(id)?;
    let revision=v["revision"].as_u64().filter(|r| *r>0 && *r<=9007199254740991).ok_or("Invalid vault revision")?;
    if v["version"]!=2 || v["encoding"]!="gzip" {return Err("Unsupported vault format".into());}
    Ok(format!("monadic-dna/explorer/data/v2|{id}|{revision}|gzip"))
}
fn crypt(key: &[u8], iv: &[u8], data: &[u8], aad: &[u8], encrypt: bool) -> Result<Vec<u8>,String> {
    if key.len()!=32 || iv.len()!=12 {return Err("Invalid vault key or nonce".into());}
    let cipher=Aes256Gcm::new_from_slice(key).map_err(|_|"Invalid vault key")?;
    let payload=Payload{msg:data,aad};
    if encrypt { cipher.encrypt(Nonce::from_slice(iv),payload) } else { cipher.decrypt(Nonce::from_slice(iv),payload) }
        .map_err(|_|"Vault authentication failed".into())
}
pub fn seal(snapshot: &str, key: &[u8], id: &str, revision: u64, iv: &[u8]) -> Result<Value,String> {
    if snapshot.len()>MAX {return Err("Vault exceeds supported size".into());}
    let mut envelope=json!({"version":2,"vaultId":id,"revision":revision,"encoding":"gzip","nonce":STANDARD.encode(iv)});
    let authenticated=aad(&envelope)?;
    let mut encoder=GzEncoder::new(Vec::new(),Compression::fast());
    encoder.write_all(snapshot.as_bytes()).map_err(|_|"Unable to compress vault")?;
    let compressed=Zeroizing::new(encoder.finish().map_err(|_|"Unable to compress vault")?);
    envelope["ciphertext"]=STANDARD.encode(crypt(key,iv,&compressed,authenticated.as_bytes(),true)?).into();
    Ok(envelope)
}
fn open_raw(envelope: &Value, key: &[u8]) -> Result<String,String> {
    let authenticated=aad(envelope)?;
    if text(envelope,"ciphertext").len()>MAX {return Err("Vault exceeds supported size".into());}
    let iv=bytes(envelope,"nonce",12)?; let ciphertext=bytes(envelope,"ciphertext",0)?;
    let compressed=Zeroizing::new(crypt(key,&iv,&ciphertext,authenticated.as_bytes(),false)?);
    let mut decoder=GzDecoder::new(compressed.as_slice()).take((MAX+1) as u64);
    let mut plain=Zeroizing::new(Vec::new()); decoder.read_to_end(&mut plain).map_err(|_|"Invalid vault compression")?;
    if plain.len()>MAX {return Err("Expanded vault exceeds supported size".into());}
    String::from_utf8(plain.to_vec()).map_err(|_|"Invalid vault encoding".into())
}
fn domain_key(key:&[u8],domain:&[u8])->Result<Zeroizing<Vec<u8>>,String> {
    if key.len()!=32 {return Err("Invalid data key length".into());}
    use hmac::{Hmac,Mac};
    let mut derived=<Hmac<sha2::Sha256> as Mac>::new_from_slice(key).map_err(|_|"Invalid data key")?;
    derived.update(domain);
    Ok(Zeroizing::new(derived.finalize().into_bytes().to_vec()))
}
pub fn genotype_key(key:&[u8])->Result<Zeroizing<Vec<u8>>,String> {
    domain_key(key,b"monadic-dna/explorer/genotype-key/v2")
}
pub fn digest(value:&Value)->String {
    use sha2::Digest;
    format!("{:x}",sha2::Sha256::digest(value.to_string().as_bytes()))
}
pub fn seal_genotypes(genotypes:&Value,key:&[u8],id:&str,iv:&[u8])->Result<Value,String> {
    let derived=genotype_key(key)?;
    seal(&genotypes.to_string(),&derived,id,1,iv)
}
pub fn seal_state(mut snapshot:Value,genotype:Value,key:&[u8],id:&str,revision:u64,iv:&[u8])->Result<Value,String> {
    snapshot.as_object_mut().ok_or("Invalid vault snapshot")?.remove("genotypes");
    let hash=digest(&genotype);snapshot["genotypeDigest"]=hash.clone().into();
    let plaintext=Zeroizing::new(snapshot.to_string());
    let state_key=domain_key(key,b"monadic-dna/explorer/state-key/v2")?;
    let mut encrypted=seal(&plaintext,&state_key,id,revision,iv)?;
    encrypted["genotype"]=genotype;encrypted["genotypeDigest"]=hash.into();Ok(encrypted)
}
pub fn open(envelope:&Value,key:&[u8])->Result<String,String> {
    let state_key=domain_key(key,b"monadic-dna/explorer/state-key/v2")?;
    let plain=Zeroizing::new(open_raw(envelope,&state_key)?);
    let mut snapshot:Value=serde_json::from_str(&plain).map_err(|_|"Invalid vault snapshot")?;
    if let Some(genotype)=envelope.get("genotype") {
        let hash=digest(genotype);
        if snapshot["genotypeDigest"]!=hash || envelope["genotypeDigest"]!=hash || envelope["vaultId"]!=genotype["vaultId"] {return Err("Genotype reference authentication failed".into());}
        let derived=genotype_key(key)?;
        let opened=Zeroizing::new(open_raw(genotype,&derived)?);
        snapshot["genotypes"]=serde_json::from_str(&opened).map_err(|_|"Invalid genotype data")?;
        snapshot.as_object_mut().unwrap().remove("genotypeDigest");
    }
    Ok(snapshot.to_string())
}
fn recovery_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8;32]>,String> {
    if password.len()<12 || password.len()>1024 || salt.len()!=16 {return Err("Use a recovery passphrase of at least 12 characters".into());}
    let params=Params::new(65536,3,1,Some(32)).map_err(|_|"Invalid key derivation")?;
    let mut key=Zeroizing::new([0u8;32]);
    Argon2::new(Algorithm::Argon2id,Version::V0x13,params).hash_password_into(password.as_bytes(),salt,&mut *key).map_err(|_|"Key derivation failed")?;
    Ok(key)
}
pub fn dispatch(op: &str, input: &Value) -> Result<Value,String> {
    match op {
        "vault_record_mac" | "vault_record_verify" => {
            use hmac::{Hmac, Mac};
            let key=Zeroizing::new(bytes(input,"key",32)?);
            let mut record=input["record"].as_object().cloned().ok_or("Invalid vault record")?;
            let expected=record.remove("mac");
            let canonical=serde_json::to_vec(&record).map_err(|_|"Invalid vault record")?;
            let authentication_key=domain_key(&key,b"monadic-dna/explorer/record-mac-key/v2")?;
            let mut mac=<Hmac<sha2::Sha256> as Mac>::new_from_slice(&authentication_key).map_err(|_|"Invalid key")?;
            mac.update(b"monadic-dna/explorer/local-record/v2|");mac.update(&canonical);
            if op=="vault_record_verify" {
                let expected=STANDARD.decode(expected.as_ref().and_then(Value::as_str).unwrap_or("")).map_err(|_|"Invalid vault record")?;
                mac.verify_slice(&expected).map_err(|_|"Vault record authentication failed")?;Ok(Value::Bool(true))
            } else {Ok(STANDARD.encode(mac.finalize().into_bytes()).into())}
        },
        "vault_genotype_digest"=>Ok(digest(&input["genotype"]).into()),
        "vault_seal" => {
            let key=Zeroizing::new(bytes(input,"key",32)?);let id=text(input,"vaultId");let nonce=bytes(input,"nonce",12)?;
            let snapshot:Value=serde_json::from_str(text(input,"snapshot")).map_err(|_|"Invalid snapshot")?;
            let genotype=seal_genotypes(&snapshot["genotypes"],&key,id,&nonce)?;
            seal_state(snapshot,genotype,&key,id,input["revision"].as_u64().unwrap_or(0),&nonce)
        },
        "vault_open" => {let key=Zeroizing::new(bytes(input,"key",32)?); Ok(open(&input["envelope"],&key)?.into())},
        "vault_wrap_key" => {
            let id=text(input,"vaultId");identity(id)?;
            let salt=bytes(input,"salt",16)?;let nonce=bytes(input,"nonce",12)?;
            let key=recovery_key(text(input,"password"),&salt)?;let data_key=Zeroizing::new(bytes(input,"key",32)?);
            let encrypted=crypt(&*key,&nonce,&data_key,format!("monadic-dna/explorer/key/v2|{id}").as_bytes(),true)?;
            Ok(json!({"version":2,"vaultId":id,"kdf":"Argon2id-64MiB-3","salt":STANDARD.encode(salt),"nonce":STANDARD.encode(nonce),"ciphertext":STANDARD.encode(encrypted)}))
        },
        "vault_unwrap_key" => {
            let wrapped=&input["wrappedKey"];let id=text(wrapped,"vaultId");identity(id)?;
            if wrapped["version"]!=2 || wrapped["kdf"]!="Argon2id-64MiB-3" {return Err("Unsupported recovery format".into());}
            let key=recovery_key(text(input,"password"),&bytes(wrapped,"salt",16)?)?;
            let decoded=Zeroizing::new(crypt(&*key,&bytes(wrapped,"nonce",12)?,&bytes(wrapped,"ciphertext",0)?,format!("monadic-dna/explorer/key/v2|{id}").as_bytes(),false)?);
            if decoded.len()!=32 {return Err("Invalid recovered key".into());}
            Ok(STANDARD.encode(&*decoded).into())
        },
        _ => Err("Unknown vault operation".into())
    }
}
