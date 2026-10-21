// Run after npm run core:build; includes actual TypeScript/WASM boundary costs.
import {coreCall} from '../lib/core';
const session=coreCall<number>('session_create');
try{
  coreCall('session_import',{session,content:'# 23andMe\nrs1 1 100 AG',fileName:'synthetic-benchmark.txt'});
  const studies=Array.from({length:20000},(_,i)=>({id:i+1,study_accession:'GCST'+i,snps:i%5===0?'rs1':'rs2',strongest_snp_risk_allele:i%5===0?'rs1-A':'rs2-A',or_or_beta:'1.2',ci_text:'[1.1-1.3]',disease_trait:'Benchmark',study:'Benchmark study'}));
  const start=performance.now();const results=coreCall<unknown[]>('session_analyze',{session,studies,strict:true,now:'2026-10-21T00:00:00Z'});
  if(results.length!==4000)throw new Error('Unexpected result count');
  console.log(JSON.stringify({studies:studies.length,matches:results.length,milliseconds:performance.now()-start}));
}finally{coreCall('session_close',{session});}
