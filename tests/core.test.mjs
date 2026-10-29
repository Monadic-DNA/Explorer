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
  // nilAI's /public_key endpoint returns the key as a JSON string; the raw response body must work.
  assert.equal(coreCall('nilai_invocation', { ...input, serverKey: JSON.stringify(input.serverKey) + '\n' }).split('/').length, token.split('/').length);
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
  // Regular Chat is free; Research in Chat is the premium Chat feature.
  assert.deepEqual(coreCall('feature_access',{kind:'Chat'}),{allowed:true,reportType:null});
  assert.deepEqual(coreCall('feature_access',{kind:'Research'}),{allowed:false,reportType:null});
  assert.equal(coreCall('feature_access',{kind:'Research',activeSubscription:true}).allowed,true);
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

test('v2 recovery interoperates with independent Argon2id/AES-GCM decoder and authenticates all data', async () => {
  const {openPortableVault}=await import('./vault-format.mjs');
  const key=randomBytes(32).toString('base64'),vaultId='8492f2d1-a425-4a33-8f44-ea25fe126f06',password='unique test recovery passphrase';
  const snapshot={version:1,genotypes:{rs1:'AG'},results:[],metadata:{fileName:'private.txt',count:1},customization:{fields:{age:'42',ethnicities:'South Asian'},context:'private context'}};
  const envelope=coreCall('vault_seal',{snapshot:JSON.stringify(snapshot),key,vaultId,revision:7,nonce:randomBytes(12).toString('base64')});
  const wrappedKey=coreCall('vault_wrap_key',{key,vaultId,password,salt:randomBytes(16).toString('base64'),nonce:randomBytes(12).toString('base64')});
  const archive={version:2,envelope,wrappedKey};archive.mac=coreCall('vault_record_mac',{key,record:archive});
  assert.deepEqual(openPortableVault(archive,password),snapshot);
  assert.equal(coreCall('vault_unwrap_key',{wrappedKey,password}),key);
  assert.deepEqual(JSON.parse(coreCall('vault_open',{envelope,key})),snapshot);
  assert.throws(()=>coreCall('vault_unwrap_key',{wrappedKey,password:'wrong test password'}));
  assert.throws(()=>coreCall('vault_unwrap_key',{wrappedKey:{...wrappedKey,vaultId:'11111111-1111-1111-1111-111111111111'},password}));
  assert.throws(()=>coreCall('vault_open',{envelope:{...envelope,revision:8},key}));
  assert.throws(()=>coreCall('vault_open',{envelope:{...envelope,genotypeDigest:'0'.repeat(64)},key}));
  assert.throws(()=>coreCall('vault_open',{envelope:{...envelope,genotype:{...envelope.genotype,nonce:randomBytes(12).toString('base64')}},key}));
  assert.throws(()=>coreCall('vault_record_verify',{key,record:{...archive,wrappedKey:{...wrappedKey,salt:randomBytes(16).toString('base64')}}}));
  assert.throws(()=>coreCall('vault_open',{envelope,key:randomBytes(32).toString('base64')}));
  const session=coreCall('session_create');
  try {
    coreCall('session_restore',{session,snapshot:coreCall('vault_open',{envelope,key})});
    assert.deepEqual(coreCall('session_customization',{session}),snapshot.customization);
    assert.equal(coreCall('session_metadata',{session}).count,1);
  } finally{coreCall('session_close',{session});}
});

test('cross-platform customization preserves additional report context',()=>{
  assert.match(coreCall('user_context',{additionalContext:'custom recovery context'}),/Additional context: custom recovery context/);
});

test('batch Run All matches session results exactly and keeps order and overwrite semantics',()=>{
  const genotypes={rs1:'AG',rs2:'CC',rs3:'--'};
  const template={study_accession:'GCST1',snps:'rs1',strongest_snp_risk_allele:'rs1-A',or_or_beta:'0.25',ci_text:'unit decrease',study:'Batch study',disease_trait:'Test trait'};
  const studies=Array.from({length:1200},(_,i)=>({...template,id:i+1,...(i%3===0?{snps:'rs2',strongest_snp_risk_allele:'rs2-A'}:{})}));
  studies.push({...template,id:1,study:'Latest duplicate'}, {...template,id:2001,or_or_beta:''},{...template,id:2002,snps:'rs3',strongest_snp_risk_allele:'rs3-A'});
  const now='2026-10-21T00:00:00Z',session=coreCall('session_create');
  try {
    coreCall('session_restore',{session,snapshot:JSON.stringify({version:1,genotypes,results:[],metadata:{count:3}})});
    const expected=coreCall('analyze_studies',{genotypes,studies,strict:true,now});
    assert.deepEqual(coreCall('session_analyze',{session,studies,strict:true,now}),expected);
    assert.equal(coreCall('session_analyze_count',{session,studies,strict:true,now}),expected.length);
    const stored=coreCall('session_results',{session});
    assert.equal(stored.length,new Set(expected.map(row=>row.studyId)).size);
    assert.equal(coreCall('session_result_count',{session}),stored.length);
    assert.equal(stored.find(row=>row.studyId===1).studyTitle,'Latest duplicate');
    assert.deepEqual(stored.map(row=>row.studyId),[...new Set(expected.map(row=>row.studyId))]);
    assert.ok(expected.every(row=>row.riskScore===-0.25));
  }finally{coreCall('session_close',{session});}
});

test('research prompts: keyword parsing, model description and prompt contents', () => {
  assert.deepEqual(coreCall('research_parse_keywords',{content:'  Taste receptors \n\nOlfaction\n',query:'q'}),['Taste receptors','Olfaction']);
  assert.deepEqual(coreCall('research_parse_keywords',{content:'\n  \n',query:'What foods will I like?'}),['What foods will I like?']);
  assert.equal(coreCall('research_parse_keywords',{content:Array.from({length:14},(_,i)=>`k${i}`).join('\n'),query:'q'}).length,10);
  assert.deepEqual(coreCall('research_extract',{content:'Answer text\n\nFOLLOWUP:\n- One?\n- Two?\nnot a question'}),{answer:'Answer text',questions:['One?','Two?']});
  assert.deepEqual(coreCall('research_extract',{content:'  Only an answer '}),{answer:'Only an answer',questions:[]});
  assert.equal(coreCall('llm_description',{provider:'nilai'}),'🛡️ Powered by Nillion nilAI using google/gemma-4-26B-A4B-it in TEE (Trusted Execution Environment)');
  assert.equal(coreCall('llm_description',{provider:'ollama',model:'llama3',ollamaAddress:'10.0.0.2',ollamaPort:1234}),'🖥️ Using local Ollama (llama3) at 10.0.0.2:1234');
  const synthesis=coreCall('research_synthesis_prompt',{query:'Q',customization:'',llmDescription:'D',totalResults:86859,analyses:[{keyword:'k',analysis:'a',resultsCount:3}]});
  assert.equal(synthesis.maxTokens,3000);assert.equal(synthesis.reasoningEffort,'medium');
  assert.match(synthesis.messages[0].content,/Total results in user profile: 86,859[\s\S]*No personalization set|No personalization set[\s\S]*86,859/);
  assert.match(synthesis.messages[0].content,/\*\*Angle: k\*\* \(3 studies\)\na/);
  assert.equal(synthesis.messages[1].content,'Q');
  const angle=coreCall('research_angle_prompt',{query:'Q',keyword:'k',llmDescription:'D',results:[{traitName:'T',studyTitle:'S',userGenotype:'AG',riskAllele:'rs1-A',riskScore:-0.0456,riskLevel:'decreased',effectType:'beta',matchedSnp:'rs1'}]});
  assert.match(angle.messages[0].content,/1\. T \(S\):\n   - Your genotype: AG\n   - Risk allele: rs1-A\n   - Risk score: β=-0\.046 units \(decreased\)\n   - SNP: rs1/);
});

