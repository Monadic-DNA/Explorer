import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto, randomBytes } from 'node:crypto';
import ts from 'typescript';

// Exercise the real TS adapter (not a reimplementation of its WASM ABI).
const generated = readFileSync(new URL('../lib/generated/core-wasm.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../lib/core.ts', import.meta.url), 'utf8').replace(/import \{ coreWasmBase64 \} from .*;\n/, generated);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { coreCall } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const fixtures = JSON.parse(readFileSync(new URL('fixtures/core.json', import.meta.url), 'utf8'));
for (const item of fixtures) test(item.name, () => assert.deepEqual(coreCall(item.operation, item.input), item.expected));

test('encrypted files interoperate with existing WebCrypto format', async () => {
  const password = 'test-only passphrase';
  const salt = randomBytes(16), iv = randomBytes(12);
  const input = { plaintext: 'private DNA 🧬\nrs123\tAG', password, salt: salt.toString('base64'), iv: iv.toString('base64'), iterations: 100000 };
  const sealed = coreCall('seal', input);
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, Buffer.from(sealed.ciphertext, 'base64'));
  assert.equal(new TextDecoder().decode(plain), input.plaintext);
  const existing = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(input.plaintext));
  assert.equal(coreCall('open', { ...sealed, ciphertext: Buffer.from(existing).toString('base64'), password }), input.plaintext);
  assert.throws(() => coreCall('open', { ...sealed, password: 'wrong' }), /incorrect password/);
  assert.throws(() => coreCall('open', { ...sealed, password, ciphertext: randomBytes(32).toString('base64') }));
});

test('auth callback is encrypted to the requesting device and bound to state', () => {
  const device = coreCall('auth_keypair', { entropy: randomBytes(32).toString('base64') });
  const other = coreCall('auth_keypair', { entropy: randomBytes(32).toString('base64') });
  const sealed = coreCall('auth_seal', { publicKey: device.publicKey, entropy: randomBytes(32).toString('base64'), iv: randomBytes(12).toString('base64'), state: 'expected-state', plaintext: 'test-token-not-a-real-credential' });
  assert.equal(coreCall('auth_open', { ...sealed, privateKey: device.privateKey, state: 'expected-state' }), 'test-token-not-a-real-credential');
  assert.throws(() => coreCall('auth_open', { ...sealed, privateKey: other.privateKey, state: 'expected-state' }));
  assert.throws(() => coreCall('auth_open', { ...sealed, privateKey: device.privateKey, state: 'forged-state' }));
});

test('native session owns genome and result state with portable backup', () => {
  const session = coreCall('session_create');
  try {
    const metadata = coreCall('session_import', { session, content: '# 23andMe\nrs1 1 100 AG', fileName: 'test.txt' });
    assert.equal(metadata.count, 1);
    const studies = [{ id: 1, study_accession: 'GCST1', snps: 'rs1', strongest_snp_risk_allele: 'rs1-A', or_or_beta: '2', ci_text: '[1.5-2.5]', disease_trait: 'Test trait', study: 'Test study' }];
    const matched = coreCall('session_analyze', { session, studies, now: '2026-01-01T00:00:00Z' });
    assert.equal(matched[0].riskScore, 2);
    coreCall('session_analyze', { session, studies, now: '2026-01-01T00:00:00Z' });
    assert.equal(coreCall('session_results', { session }).length, 1);
    const snapshot = coreCall('session_snapshot', { session });
    const exported = coreCall('session_export', { session });
    assert.match(exported, /Replication Sample Size/);
    coreCall('session_clear', { session });
    assert.equal(coreCall('session_results', { session }).length, 0);
    coreCall('session_restore', { session, snapshot });
    assert.equal(coreCall('session_results', { session })[0].riskScore, 2);
    const imported = coreCall('import_results', { content: exported, fileName: 'test.tsv', now: '2026-01-01T00:00:00Z' });
    assert.equal(imported.results[0].matchedSnp, 'rs1');
  } finally { coreCall('session_close', { session }); }
});

test('unknown protocol and malformed input do not corrupt subsequent calls', () => {
  assert.throws(() => coreCall('unknown', {}), /Unknown/);
  assert.throws(() => coreCall('partition_results', { groups: 0 }), /Group count/);
  assert.equal(coreCall('version').protocol, 1);
});

test('closed native sessions cannot address a new genome session', () => {
  const old=coreCall('session_create');
  coreCall('session_close',{session:old});
  const current=coreCall('session_create');
  try {
    assert.notEqual(old,current);
    assert.throws(()=>coreCall('session_import',{session:old,content:'# 23andMe\nrs1 1 100 AG'}),/closed/);
    assert.throws(()=>coreCall('session_restore',{session:current,snapshot:JSON.stringify({version:1,genotypes:{},results:[],metadata:null})}),/metadata/);
  } finally { coreCall('session_close',{session:current}); }
});

test('nilAI NUC authentication interoperates with the existing Nillion SDK', async () => {
  const { NucTokenEnvelopeSchema, NucTokenBuilder, Did, Command, Keypair, InvocationBody } = await import('@nillion/nuc');
  const server = Keypair.from('02'.repeat(32)); // Public test vector, never a live account key.
  const client = coreCall('nilai_keypair', { entropy: Buffer.alloc(32, 1).toString('base64') });
  const now = 1_800_000_000;
  const input = { privateKey: client.privateKey, serverKey: Buffer.from(server.publicKey()).toString('base64'), nonce: Buffer.alloc(16, 3).toString('base64'), rootNonce: Buffer.alloc(16, 4).toString('base64'), now };
  const token = coreCall('nilai_invocation', input);
  const envelope = NucTokenEnvelopeSchema.parse(token);
  envelope.validateSignatures();
  assert.equal(envelope.token.token.audience.toString(), new Did(server.publicKey()).toString());
  assert.equal(envelope.token.token.command.toString(), '/nil/ai/generate');
  assert.ok(envelope.token.token.body instanceof InvocationBody);
  const root = NucTokenBuilder.delegation([]).command(new Command(['nil', 'ai', 'generate'])).subject(new Did(server.publicKey())).audience(new Did(server.publicKey())).expiresAt(now+600).build(server.privateKey());
  const grant = NucTokenBuilder.extending(NucTokenEnvelopeSchema.parse(root)).audience(Did.fromHex(client.publicKey)).expiresAt(now+300).meta({ usage_limit: 1 }).build(server.privateKey());
  const delegated = coreCall('nilai_invocation', { ...input, delegation: grant });
  NucTokenEnvelopeSchema.parse(delegated).validateSignatures();
  assert.equal(NucTokenEnvelopeSchema.parse(delegated).proofs.length, 2);
  assert.equal(coreCall('nilai_info', grant).expiresAt, now+300);
  assert.throws(() => coreCall('nilai_invocation', { ...input, delegation: grant, now: now+301 }), /expired/);
  assert.throws(() => coreCall('nilai_invocation', { ...input, privateKey: '🎉' }), /Invalid/);
});

test('gzip import shares the same bounded decoder across native and web adapters', async () => {
  const { gzipSync } = await import('node:zlib');
  const source = '# 23andMe\nrs1 1 100 AG';
  const bytes = gzipSync(source).toString('base64');
  assert.equal(coreCall('decode_file', { bytes }), source);
  assert.equal(coreCall('decode_file', { bytes: Buffer.concat([gzipSync(source),Buffer.from('provider trailer')]).toString('base64') }),source);
  assert.equal(coreCall('decode_file', { bytes: Buffer.concat([gzipSync('first'),gzipSync('second')]).toString('base64') }),'firstsecond');
  assert.throws(() => coreCall('decode_file', { bytes: Buffer.from([0x1f,0x8b,0]).toString('base64') }));
});

const reportFixtures = JSON.parse(readFileSync(new URL('fixtures/reports.json', import.meta.url), 'utf8'));
for (const fixture of reportFixtures.cases) test(`existing ${fixture.kind} selection and prompt (history=${fixture.withHistory})`, () => {
  const input = { kind: fixture.kind, results: reportFixtures.results, customization: fixture.withHistory ? reportFixtures.customization : null };
  const selection = coreCall('select_report', input);
  const identities = selection.selected.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => ['studyId', 'domain', 'matchedCondition'].includes(key))));
  assert.deepEqual(identities, fixture.selected);
  assert.deepEqual(selection.counts, fixture.counts);
  const prompt = coreCall('report_prompt', input).messages[1].content;
  assert.equal(prompt.replace(/\s+/g, ' ').trim(), fixture.prompt.replace(/\s+/g, ' ').trim());
});

test('personalization and report questions share portable formats', () => {
  const profile = coreCall('parse_profile', { age: '42', personalConditions: 'asthma, type 2 diabetes', smokingHistory: 'never-smoked' });
  assert.equal(profile.age, 42);
  assert.deepEqual(profile.personalConditions, ['asthma', 'type 2 diabetes']);
  assert.match(coreCall('user_context', profile), /Never smoked/);
  assert.throws(() => coreCall('parse_profile', { age: 'invalid' }));
  assert.deepEqual(coreCall('extract_report', 'A report.\n\nCHAT_QUESTIONS:\n- What about rs1?\n- More detail?'), { report: 'A report.', questions: ['What about rs1?', 'More detail?'] });
});

test('native premium policy distinguishes free reports, subscriptions and report passes',()=>{
  assert.equal(coreCall('feature_access',{kind:'Health'}).allowed,true);
  assert.deepEqual(coreCall('feature_access',{kind:'Overview'}),{allowed:false,reportType:'overview'});
  assert.deepEqual(coreCall('feature_access',{kind:'Chat',activeSubscription:true}),{allowed:true,reportType:null});
  assert.equal(coreCall('feature_access',{kind:'Healthspan',promo:'invalid'}).allowed,false);
  const session=coreCall('session_create');
  try { const snapshot=coreCall('session_snapshot',{session});assert.deepEqual(coreCall('session_restore',{session,snapshot}),{count:0}); }
  finally{coreCall('session_close',{session});}
});

test('large native imports keep only compact genotype state and enforce strict Run All matching', () => {
  const session=coreCall('session_create');
  try {
    coreCall('session_import',{session,content:'# 23andMe\nrs1 1 100 TT\nrs2 2 200 AG'});
    const study={id:9,snps:'rs1;rs2',strongest_snp_risk_allele:'rs1-A',or_or_beta:'2',study_accession:'GCST9'};
    assert.deepEqual(coreCall('session_analyze',{session,strict:true,studies:[study]}),[]);
  } finally{coreCall('session_close',{session});}
});
