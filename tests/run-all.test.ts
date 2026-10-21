import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {runAllAnalysisOnboarding} from '../lib/run-all-onboarding';
import {AnalysisPool} from '../lib/analysis-pool';
import type {GWASStudy} from '../lib/gwas-db';

test('onboarding uses the shared scorer across UTF-8 chunk boundaries, final lines, limits and existing results',async()=>{
  const rows=JSON.parse(readFileSync('tests/fixtures/public-sample-studies.json','utf8')) as GWASStudy[];
  const genotypes=new Map<string,string>();
  for(const row of rows){const [id,base]=(row.strongest_snp_risk_allele||'').split('-');if(id && /^[ACGT]$/.test(base||''))genotypes.set(id,base+base);}
  const now='2026-10-21T00:00:00Z',pool=new AnalysisPool();
  const expected=await pool.analyze(rows,genotypes,now);pool.close();
  assert.ok(expected.length>5);
  const first=rows.find(row=>row.id===expected[0].studyId)!;
  first.study='é'.repeat(1048570)+'🧬 final boundary';
  const fields=['id','study_accession','disease_trait','study','snps','strongest_snp_risk_allele','or_or_beta','ci_text','p_value','pvalue_mlog','mapped_gene','initial_sample_size','replication_sample_size'] as const;
  // CRLF and no trailing newline exercise both streaming and final-record handling.
  const text=fields.join('\t')+'\r\n'+rows.map(row=>fields.map(key=>String(row[key]??'').replace(/[\t\r\n]/g,' ')).join('\t')).join('\r\n');
  const compressed=gzipSync(text),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(compressed,{status:200,headers:{'Content-Length':String(compressed.length)}});
  try{
    const phases:string[]=[];
    const actual=await runAllAnalysisOnboarding(genotypes,progress=>phases.push(progress.phase),()=>false);
    assert.deepEqual(actual.map(row=>row.studyId),expected.map(row=>row.studyId));
    assert.equal(actual[0].studyTitle,first.study);
    for(let i=0;i<actual.length;i++)for(const key of ['riskScore','effectType','riskLevel','matchedSnp','userGenotype'] as const)assert.equal(actual[i][key],expected[i][key]);
    assert.ok(phases.includes('analyzing'));assert.equal(phases.at(-1),'complete');
    const limited=await runAllAnalysisOnboarding(genotypes,()=>{},id=>id===expected[0].studyId,{maxResults:5});
    assert.deepEqual(limited.map(row=>row.studyId),expected.slice(1,6).map(row=>row.studyId));
  }finally{globalThis.fetch=originalFetch;}
});
