import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { authenticate, deleteAccount, listRecords, readRecords, writeRecord, type SignedHeaders } from '../lib/vault-sync';
import { getDb } from '../lib/db';

// An independent secp256k1 signer that produces the same requests as the native core.
function device() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url'), y = Buffer.from(jwk.y!, 'base64url');
  const compressed = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]).toString('hex');
  return { key: privateKey, publicKey: compressed, account: createHash('sha256').update(Buffer.from(compressed, 'hex')).digest('hex') };
}
function signed(d: { key: KeyObject; publicKey: string; account: string }, body: string, timestamp = Math.floor(Date.now() / 1000)): SignedHeaders {
  const nonce = randomBytes(16).toString('hex');
  const message = `monadic-dna/explorer/sync/v1\n${timestamp}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`;
  const raw = sign('sha256', Buffer.from(message), { key: d.key, dsaEncoding: 'ieee-p1363' });
  const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  let s = BigInt('0x' + raw.subarray(32).toString('hex')); if (s > n / BigInt(2)) s = n - s;
  return { account: d.account, publicKey: d.publicKey, timestamp: String(timestamp), nonce, signature: raw.subarray(0, 32).toString('hex') + s.toString(16).padStart(64, '0') };
}
const status = (status: number) => (error: unknown) => (error as { status?: number }).status === status;

test('signed requests are rejected before any database access when malformed, expired, forged or misattributed', async () => {
  const d = device(), body = '{"action":"list"}';
  const good = signed(d, body);
  await assert.rejects(authenticate({ ...good, nonce: 'short' }, body), status(401));
  await assert.rejects(authenticate(signed(d, body, Math.floor(Date.now() / 1000) - 3600), body), status(401));
  await assert.rejects(authenticate(good, '{"action":"delete"}'), status(401));
  await assert.rejects(authenticate({ ...good, account: device().account }, body), status(401));
});

test('sync records: replay protection, compare-and-set, account isolation, size limits and deletion', { skip: process.env.VAULT_DB_TEST !== 'true' }, async () => {
  assert.match(process.env.POSTGRES_DB || '', /^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\//);
  const a = device(), b = device(), body = '{"action":"list"}';
  try {
    const headers = signed(a, body);
    assert.equal(await authenticate(headers, body), a.account);
    await assert.rejects(authenticate(headers, body), status(401), 'a nonce works once');
    const ciphertext = randomBytes(64).toString('base64');
    const first = await Promise.allSettled(Array.from({ length: 5 }, () => writeRecord(a.account, 'genotype', 0, ciphertext)));
    assert.equal(first.filter(r => r.status === 'fulfilled').length, 1, 'one concurrent first write wins');
    const conflict = await writeRecord(a.account, 'genotype', 0, ciphertext).catch(e => e);
    assert.equal(conflict.status, 409); assert.equal(conflict.revision, 1);
    assert.equal(await writeRecord(a.account, 'genotype', 1, ciphertext), 2);
    assert.deepEqual((await listRecords(a.account)).map(r => [r.record, r.revision]), [['genotype', 2]]);
    assert.deepEqual(await readRecords(a.account, ['genotype']), [{ record: 'genotype', revision: 2, ciphertext }]);
    await authenticate(signed(b, body), body);
    assert.deepEqual(await listRecords(b.account), [], 'accounts are isolated');
    await assert.rejects(writeRecord(a.account, 'other', 0, ciphertext), status(400));
    await assert.rejects(writeRecord(a.account, 'results', 0, Buffer.alloc(25 * 1024 * 1024).toString('base64')), status(413));
    await deleteAccount(a.account);
    assert.deepEqual(await listRecords(a.account), []);
  } finally {
    for (const d of [a, b]) await deleteAccount(d.account);
    await getDb().end();
  }
});
