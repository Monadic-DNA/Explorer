// Builds the research catalog snapshot that native app releases bundle for Run all.
//
//   node scripts/catalog-snapshot.mjs
//
// Prompts for a Postgres connection string (or reads CATALOG_DATABASE_URL), exports
// gwas_catalog in a read-only transaction, writes catalog/dist/<file>.zst and updates
// catalog/snapshot.json. Upload the file to the Space as a public-read object, then
// commit snapshot.json; scripts/build-native.mjs fetches and verifies it for each app.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { constants, zstdCompressSync } from 'node:zlib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Snapshots live at the bucket root and are served through the Space's CDN endpoint.
const CDN='https://monadic-dna-explorer.nyc3.cdn.digitaloceanspaces.com';
const FORMAT=1;
const BATCH=50000;
// Study-level text is stored once per distinct record; association rows reference it by index.
const STUDY_COLUMNS=['study_accession','study','initial_sample_size','replication_sample_size'];
const ROW_COLUMNS=['id','snps','strongest_snp_risk_allele','or_or_beta','ci_text','disease_trait','p_value','pvalue_mlog','mapped_gene'];

function prompt(question){
  return new Promise(resolve=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
    // Keep the connection string, which contains a password, off the screen.
    rl._writeToOutput=text=>{if(text.includes(question))process.stdout.write(text)};
    rl.question(question,answer=>{rl.close();process.stdout.write('\n');resolve(answer.trim())});
  });
}

function sslConfig(connection){
  const host=new URL(connection).hostname;
  if(['localhost','127.0.0.1','[::1]'].includes(host))return false;
  // Same rule as lib/db.ts: managed databases must present a certificate we can verify.
  if(process.env.DATABASE_CA_CERT)return {ca:process.env.DATABASE_CA_CERT,rejectUnauthorized:true};
  const ca=path.join(root,'certs','ca-certificate.crt');
  return existsSync(ca)?{ca:readFileSync(ca,'utf8'),rejectUnauthorized:true}:{rejectUnauthorized:true};
}

const clean=value=>value==null?'':String(value).replace(/[\t\r\n]/g,' ');

const connection=process.env.CATALOG_DATABASE_URL||await prompt('Postgres connection string: ');
if(!connection)throw new Error('A connection string is required');
const url=new URL(connection);
// sslmode in the URL would override the verified TLS settings above.
url.searchParams.delete('sslmode');
const client=new pg.Client({connectionString:url.toString(),ssl:sslConfig(connection)});
await client.connect();
const studies=new Map();
const rows=[];
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  let last=0;
  for(;;){
    // Keyset pagination keeps each batch an index range scan.
    const {rows:batch}=await client.query(
      `SELECT ${[...ROW_COLUMNS,...STUDY_COLUMNS.filter(c=>!ROW_COLUMNS.includes(c))].join(',')}
       FROM gwas_catalog
       WHERE id>$1 AND snps<>'' AND strongest_snp_risk_allele<>''
       ORDER BY id LIMIT ${BATCH}`,[last]);
    if(batch.length===0)break;
    for(const row of batch){
      const key=STUDY_COLUMNS.map(c=>clean(row[c])).join('\t');
      let index=studies.get(key);
      if(index===undefined){index=studies.size;studies.set(key,index)}
      rows.push([...ROW_COLUMNS.map(c=>clean(row[c])),index].join('\t'));
    }
    last=batch[batch.length-1].id;
    process.stdout.write(`\rExported ${rows.length.toLocaleString()} rows`);
  }
  await client.query('COMMIT');
} finally { await client.end(); }
process.stdout.write('\n');
if(rows.length===0)throw new Error('The catalog query returned no rows');

const body=[
  `#studies\t${STUDY_COLUMNS.join('\t')}`,...studies.keys(),
  `#rows\t${ROW_COLUMNS.join('\t')}\tstudy`,...rows,''
].join('\n');
const contentHash=createHash('sha256').update(body).digest('hex');
const version=`${new Date().toISOString().slice(0,10)}-${contentHash.slice(0,8)}`;
const text=`EXPLORER-CATALOG\t${FORMAT}\t${version}\t${rows.length}\t${studies.size}\n`+body;
const compressed=zstdCompressSync(Buffer.from(text),{params:{[constants.ZSTD_c_compressionLevel]:19}});
const file=`explorer-catalog-${version}.zst`;
const sha256=createHash('sha256').update(compressed).digest('hex');
mkdirSync(path.join(root,'catalog','dist'),{recursive:true});
writeFileSync(path.join(root,'catalog','dist',file),compressed);
const snapshot={format:FORMAT,version,file,url:`${CDN}/${file}`,bytes:compressed.length,sha256,rows:rows.length,studies:studies.size,createdAt:new Date().toISOString()};
writeFileSync(path.join(root,'catalog','snapshot.json'),JSON.stringify(snapshot,null,2)+'\n');
console.log(`Wrote catalog/dist/${file} (${(compressed.length/1048576).toFixed(1)} MB, ${rows.length.toLocaleString()} rows, ${studies.size.toLocaleString()} studies)`);
console.log(`Upload it to the Space as public-read, for example:\n  s3cmd put --acl-public catalog/dist/${file} s3://monadic-dna-explorer/${file}\nThen commit catalog/snapshot.json. Native builds download and verify it from:\n  ${snapshot.url}`);
