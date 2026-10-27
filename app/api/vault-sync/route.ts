import { NextResponse } from 'next/server';
import { authenticate, deleteAccount, listRecords, MAX_REQUEST_BYTES, readRecords, VaultSyncError, writeRecord } from '@/lib/vault-sync';
export const runtime = 'nodejs';

// The signature covers the exact request bytes, so read the raw body with a size bound.
async function rawBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) throw new VaultSyncError('Encrypted record is too large', 413);
  const reader = request.body?.getReader(); if (!reader) throw new VaultSyncError('Missing request');
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new VaultSyncError('Encrypted record is too large', 413); }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}
const noStore = { 'Cache-Control': 'no-store' };
function failure(error: unknown) {
  const known = error instanceof VaultSyncError ? error : new VaultSyncError('Encrypted sync is unavailable', 503);
  const revision = (error as { revision?: number })?.revision;
  return NextResponse.json(revision === undefined ? { error: known.message } : { error: known.message, revision }, { status: known.status, headers: noStore });
}

export async function POST(request: Request) {
  try {
    if (process.env.VAULT_SYNC_ENABLED !== 'true') throw new VaultSyncError('Encrypted sync is not configured', 503);
    const body = await rawBody(request);
    const header = (name: string) => request.headers.get(`x-sync-${name}`) ?? '';
    const account = await authenticate({ account: header('account'), publicKey: header('public-key'), timestamp: header('timestamp'), nonce: header('nonce'), signature: header('signature') }, body);
    let data: Record<string, unknown>;
    try { data = JSON.parse(body); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); } catch { throw new VaultSyncError('Invalid request'); }
    switch (data.action) {
      case 'list': return NextResponse.json({ records: await listRecords(account) }, { headers: noStore });
      case 'read': return NextResponse.json({ records: await readRecords(account, data.records) }, { headers: noStore });
      case 'write': return NextResponse.json({ revision: await writeRecord(account, data.record, data.baseRevision, data.ciphertext) }, { headers: noStore });
      case 'delete': await deleteAccount(account); return NextResponse.json({ deleted: true }, { headers: noStore });
      default: throw new VaultSyncError('Invalid sync action');
    }
  } catch (error) { return failure(error); }
}
