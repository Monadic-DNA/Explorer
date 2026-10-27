// End-to-end encrypted sync storage for the native apps (docs/native-data-store.md).
// The server stores ciphertext only. Requests are signed with a key derived from the user's
// sync key; the account is the SHA-256 of that key's public half, so no sign-in is needed.
import { getDb } from './db';
import { coreCall } from './core';

export class VaultSyncError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const RECORDS = ['genotype', 'results', 'customization', 'imported-results'] as const;
export type SyncRecord = typeof RECORDS[number];
/** Request bodies carry base64 ciphertext; the genotype record is the largest at about 8 MB encoded. */
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_RECORD_BYTES = 24 * 1024 * 1024;
export const MAX_ACCOUNT_BYTES = 64 * 1024 * 1024;
export const REQUEST_WINDOW_SECONDS = 300;

export type SignedHeaders = { account: string; publicKey: string; timestamp: string; nonce: string; signature: string };

/** Verifies a signed request and registers the account on first use. Returns the account ID. */
export async function authenticate(headers: SignedHeaders, body: string, now = Date.now()): Promise<string> {
  const { account, publicKey, timestamp, nonce, signature } = headers;
  if (!/^[0-9a-f]{64}$/.test(account) || !/^0[23][0-9a-f]{64}$/.test(publicKey) || !/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{128}$/.test(signature)) {
    throw new VaultSyncError('Invalid sync request signature', 401);
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > REQUEST_WINDOW_SECONDS) throw new VaultSyncError('Sync request expired; check the device clock', 401);
  let verified: { valid: boolean; account: string };
  try { verified = coreCall('sync_verify', { publicKey, timestamp, nonce, signature, body }) as { valid: boolean; account: string }; }
  catch { throw new VaultSyncError('Invalid sync request signature', 401); }
  if (!verified.valid || verified.account !== account) throw new VaultSyncError('Invalid sync request signature', 401);
  const db = getDb();
  await db.query("DELETE FROM sync_nonces WHERE seen_at < now() - interval '10 minutes'");
  const fresh = await db.query('INSERT INTO sync_nonces(account,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING', [account, nonce]);
  if (fresh.rowCount !== 1) throw new VaultSyncError('Sync request was already used', 401);
  await db.query('INSERT INTO sync_accounts(account,public_key) VALUES($1,$2) ON CONFLICT (account) DO NOTHING', [account, publicKey]);
  return account;
}

function recordName(value: unknown): SyncRecord {
  if (typeof value !== 'string' || !(RECORDS as readonly string[]).includes(value)) throw new VaultSyncError('Unknown sync record');
  return value as SyncRecord;
}

export async function listRecords(account: string) {
  const result = await getDb().query<{ record: string; revision: string; updated_at: Date }>('SELECT record,revision,updated_at FROM sync_records WHERE account=$1', [account]);
  return result.rows.map(r => ({ record: r.record, revision: Number(r.revision), updatedAt: r.updated_at.toISOString() }));
}

export async function readRecords(account: string, names: unknown) {
  if (!Array.isArray(names) || names.length > RECORDS.length) throw new VaultSyncError('Invalid sync records');
  const wanted = names.map(recordName);
  const result = await getDb().query<{ record: string; revision: string; ciphertext: Buffer }>('SELECT record,revision,ciphertext FROM sync_records WHERE account=$1 AND record=ANY($2)', [account, wanted]);
  return result.rows.map(r => ({ record: r.record, revision: Number(r.revision), ciphertext: r.ciphertext.toString('base64') }));
}

/** Compare-and-set: succeeds only if `baseRevision` is still current, then increments the revision. */
export async function writeRecord(account: string, name: unknown, baseRevision: unknown, ciphertext: unknown) {
  const record = recordName(name);
  if (!Number.isSafeInteger(baseRevision) || (baseRevision as number) < 0) throw new VaultSyncError('Invalid sync revision');
  if (typeof ciphertext !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(ciphertext)) throw new VaultSyncError('Invalid encrypted record');
  const bytes = Buffer.from(ciphertext, 'base64');
  if (bytes.length < 28 || bytes.length > MAX_RECORD_BYTES) throw new VaultSyncError('Encrypted record is too large', 413);
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    // Serialize writes per account so the storage limit holds under concurrent uploads.
    await client.query('SELECT account FROM sync_accounts WHERE account=$1 FOR UPDATE', [account]);
    const others = await client.query<{ total: string | null }>('SELECT sum(octet_length(ciphertext)) AS total FROM sync_records WHERE account=$1 AND record<>$2', [account, record]);
    if (Number(others.rows[0]?.total ?? 0) + bytes.length > MAX_ACCOUNT_BYTES) throw new VaultSyncError('Encrypted sync storage is full', 413);
    const base = baseRevision as number;
    const written = base === 0
      ? await client.query<{ revision: string }>('INSERT INTO sync_records(account,record,revision,ciphertext) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING RETURNING revision', [account, record, bytes])
      : await client.query<{ revision: string }>('UPDATE sync_records SET revision=revision+1,ciphertext=$4,updated_at=now() WHERE account=$1 AND record=$2 AND revision=$3 RETURNING revision', [account, record, base, bytes]);
    if (!written.rows.length) {
      const current = await client.query<{ revision: string }>('SELECT revision FROM sync_records WHERE account=$1 AND record=$2', [account, record]);
      throw Object.assign(new VaultSyncError('Another device changed this record; sync again', 409), { revision: Number(current.rows[0]?.revision ?? 0) });
    }
    await client.query('COMMIT');
    return Number(written.rows[0].revision);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

/** Deletes the account's cloud copy: every record, the registered key and pending nonces. */
export async function deleteAccount(account: string) {
  const db = getDb();
  await db.query('DELETE FROM sync_accounts WHERE account=$1', [account]);
  await db.query('DELETE FROM sync_nonces WHERE account=$1', [account]);
}

