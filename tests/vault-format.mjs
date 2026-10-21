// Independent Node crypto decoder: validates the shared Rust wire format across platforms.
import { argon2Sync, createDecipheriv, createHmac, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const canonical=value=>value && typeof value==='object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export function openPortableVault(archive,password) {
  const {wrappedKey:w,envelope:e,mac,...rest}=archive;
  const kek=argon2Sync('argon2id',{message:password,nonce:Buffer.from(w.salt,'base64'),parallelism:1,tagLength:32,memory:65536,passes:3});
  function decrypt(value,key,aad) {
    const bytes=Buffer.from(value.ciphertext,'base64'),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.nonce,'base64'));
    cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(0,-16)),cipher.final()]);
  }
  const key=decrypt(w,kek,`monadic-dna/explorer/key/v2|${w.vaultId}`);
  const actual=createHmac('sha256',key).update('monadic-dna/explorer/local-record/v2|').update(JSON.stringify(canonical({...rest,envelope:e,wrappedKey:w}))).digest('base64');
  assert.equal(actual,mac,'Portable archive MAC');
  const read=(value,key)=>JSON.parse(gunzipSync(decrypt(value,key,`monadic-dna/explorer/data/v2|${value.vaultId}|${value.revision}|gzip`)));
  const state=read(e,key),derived=createHmac('sha256',key).update('monadic-dna/explorer/genotype-key/v2').digest();
  const digest=createHash('sha256').update(JSON.stringify(canonical(e.genotype))).digest('hex');
  assert.equal(state.genotypeDigest,digest);assert.equal(e.genotypeDigest,digest);
  delete state.genotypeDigest;
  return {...state,genotypes:read(e.genotype,derived)};
}
