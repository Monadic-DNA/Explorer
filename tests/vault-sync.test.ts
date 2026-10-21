import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes } from 'node:crypto';
import { readSyncedVault,writeSyncedVault,deleteSyncedVault,validateArchive,type VaultArchive } from '../lib/vault-sync';
import { getDb } from '../lib/db';
function archive():VaultArchive {
  const vaultId='8492f2d1-a425-4a33-8f44-ea25fe126f06',nonce=randomBytes(12).toString('base64'),ciphertext=randomBytes(48).toString('base64');
  const genotype={ciphertext,encoding:'gzip' as const,nonce,revision:1,vaultId,version:2 as const};
  return {version:2,mac:randomBytes(32).toString('base64'),envelope:{version:2,vaultId,revision:1,encoding:'gzip',nonce,ciphertext,genotype,genotypeDigest:createHash('sha256').update(JSON.stringify(genotype)).digest('hex')},wrappedKey:{version:2,vaultId,kdf:'Argon2id-64MiB-3',salt:randomBytes(16).toString('base64'),nonce,ciphertext}};
}
test('ciphertext-only schema validates references, bounds and key wrappers',()=>{
  const a=archive();assert.deepEqual(validateArchive(a),a);
  assert.throws(()=>validateArchive({...a,envelope:{...a.envelope,revision:0}}));
  assert.throws(()=>validateArchive({...a,envelope:{...a.envelope,genotypeDigest:'0'.repeat(64)}}));
  assert.throws(()=>validateArchive({...a,wrappedKey:{...a.wrappedKey,kdf:'weak'}}));
  assert.throws(()=>validateArchive({...a,mac:''}));
});
test('encrypted sync CAS, account isolation, delta uploads and deletion races',{skip:process.env.VAULT_DB_TEST!=='true'},async()=>{
  assert.match(process.env.POSTGRES_DB||'',/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\//);
  const wallet='0x'+randomBytes(20).toString('hex'),other='0x'+randomBytes(20).toString('hex'),a=archive();
  try {
    const initial=await Promise.allSettled(Array.from({length:5},()=>writeSyncedVault(wallet,0,a)));
    assert.equal(initial.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await readSyncedVault(other)).archive,null);
    assert.deepEqual((await readSyncedVault(wallet)).archive,a);
    assert.equal((await readSyncedVault(wallet,1)).archive,null);
    assert.equal((await readSyncedVault(wallet,0,a.envelope.genotypeDigest)).archive.envelope.genotype,undefined);
    const delta=JSON.parse(JSON.stringify(a));delete delta.envelope.genotype;delta.envelope.revision=2;
    const writes=await Promise.allSettled(Array.from({length:5},()=>writeSyncedVault(wallet,1,delta)));
    assert.equal(writes.filter(x=>x.status==='fulfilled').length,1);
    assert.deepEqual((await readSyncedVault(wallet)).archive.envelope.genotype,a.envelope.genotype);
    await assert.rejects(deleteSyncedVault(wallet,1),/changed/);
    await assert.rejects(writeSyncedVault(other,0,delta),/Invalid encrypted archive/);
    await deleteSyncedVault(wallet,2);
    await assert.rejects(writeSyncedVault(wallet,2,a),/removed/);
    assert.equal((await readSyncedVault(wallet)).archive,null);
  } finally{await getDb().query('DELETE FROM encrypted_user_vaults WHERE wallet=ANY($1::text[])',[[wallet,other]]);await getDb().end();}
});
