import { createHash } from 'node:crypto';
import { getDb } from './db';
export class VaultSyncError extends Error { constructor(message: string, public status=400) { super(message); } }
export const MAX_SYNC_BYTES=40*1024*1024;
type Cipher = { version:2; vaultId:string; nonce:string; ciphertext:string };
type Genotype = Cipher & {revision:number;encoding:'gzip'};
export type VaultArchive = { version:2; mac:string; envelope:Cipher & {revision:number;encoding:'gzip';genotype:Genotype;genotypeDigest:string}; wrappedKey:Cipher & {kdf:'Argon2id-64MiB-3';salt:string} };
function base64(value:unknown, length?:number): value is string {
  return typeof value==='string' && value.length<=MAX_SYNC_BYTES && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && (length===undefined ? value.length>=24 : Buffer.from(value,'base64').length===length) && Buffer.from(value,'base64').toString('base64')===value;
}
export function validateArchive(value:unknown): VaultArchive {
  if (!value || typeof value!=='object') throw new VaultSyncError('Invalid encrypted archive');
  const {version,mac,envelope:e,wrappedKey:k}=value as VaultArchive;
  if(!base64(mac,32) || version!==2 || !e || !k || e.version!==2 || k.version!==2 || e.vaultId!==k.vaultId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.vaultId)
    || !e.genotype || e.genotype.version!==2 || e.genotype.vaultId!==e.vaultId || e.genotype.revision!==1 || e.genotype.encoding!=='gzip' || !base64(e.genotype.nonce,12) || !base64(e.genotype.ciphertext) || !/^[0-9a-f]{64}$/.test(e.genotypeDigest)
    || !Number.isSafeInteger(e.revision) || e.revision<1 || e.encoding!=='gzip' || k.kdf!=='Argon2id-64MiB-3' || !base64(e.nonce,12) || !base64(k.nonce,12) || !base64(k.salt,16) || !base64(k.ciphertext,48) || !base64(e.ciphertext)) throw new VaultSyncError('Invalid encrypted archive');
  const genotype:Genotype={ciphertext:e.genotype.ciphertext,encoding:'gzip',nonce:e.genotype.nonce,revision:1,vaultId:e.vaultId,version:2};
  if(createHash('sha256').update(JSON.stringify(genotype)).digest('hex')!==e.genotypeDigest) throw new VaultSyncError('Invalid genotype reference');
  // Reconstruct the supported ciphertext-only schema, discarding unrelated fields.
  return {version:2,mac,envelope:{version:2,vaultId:e.vaultId,revision:e.revision,encoding:'gzip',nonce:e.nonce,ciphertext:e.ciphertext,genotype,genotypeDigest:e.genotypeDigest},wrappedKey:{version:2,vaultId:k.vaultId,kdf:'Argon2id-64MiB-3',salt:k.salt,nonce:k.nonce,ciphertext:k.ciphertext}};
}
export async function readSyncedVault(wallet:string,knownRevision?:number,knownGenotype?:string) {
  const result=await getDb().query<{revision:string;archive:VaultArchive}>('SELECT revision,archive FROM encrypted_user_vaults WHERE wallet=$1',[wallet]);
  if(!result.rows.length)return {revision:0,archive:null,genotypeDigest:null};
  const row=result.rows[0], revision=Number(row.revision), hash=row.archive.envelope.genotypeDigest;
  if(revision===knownRevision)return {revision,archive:null,genotypeDigest:hash};
  const archive=JSON.parse(JSON.stringify(row.archive));
  if(hash===knownGenotype)delete archive.envelope.genotype;
  return {revision,archive,genotypeDigest:hash};
}
export async function writeSyncedVault(wallet:string,base:number,input:unknown) {
  if(!Number.isSafeInteger(base) || base<0) throw new VaultSyncError('Invalid sync revision');
  const client=await getDb().connect();
  try {
    await client.query('BEGIN');
    const current=await client.query<{revision:string;vault_id:string;archive:VaultArchive}>('SELECT revision,vault_id,archive FROM encrypted_user_vaults WHERE wallet=$1 FOR UPDATE',[wallet]);
    if(!input || typeof input!=="object") throw new VaultSyncError("Invalid encrypted archive");
    const archive=JSON.parse(JSON.stringify(input));
    if(!archive?.envelope?.genotype && current.rows[0]?.archive.envelope.genotypeDigest===archive?.envelope?.genotypeDigest)archive.envelope.genotype=current.rows[0].archive.envelope.genotype;
    const validated=validateArchive(archive);
    if(current.rows.length) {
      if(Number(current.rows[0].revision)!==base || current.rows[0].vault_id.toLowerCase()!==validated.envelope.vaultId.toLowerCase()) throw new VaultSyncError('Another device changed this vault. Download its latest version before uploading.',409);
      await client.query('UPDATE encrypted_user_vaults SET revision=revision+1,archive=$2,updated_at=now() WHERE wallet=$1',[wallet,validated]);
    } else {
      if(base!==0) throw new VaultSyncError('The cloud copy was removed. Re-enable sync explicitly before creating a new copy.',409);
      const created=await client.query('INSERT INTO encrypted_user_vaults(wallet,vault_id,revision,archive) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING RETURNING revision',[wallet,validated.envelope.vaultId,validated]);
      if(!created.rowCount) throw new VaultSyncError('Another device created a cloud vault. Download it before uploading.',409);
    }
    await client.query('COMMIT');return base+1;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export async function deleteSyncedVault(wallet:string,base:number) {
  if(!Number.isSafeInteger(base) || base<1) throw new VaultSyncError('Invalid sync revision');
  const result=await getDb().query('DELETE FROM encrypted_user_vaults WHERE wallet=$1 AND revision=$2',[wallet,base]);
  if(!result.rowCount) throw new VaultSyncError('Cloud data changed. Refresh before deleting.',409);
}
