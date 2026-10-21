import {AnalysisPool} from "./analysis-pool";
import type {GWASStudy} from "./gwas-db";
import * as pako from "pako";
import type { SavedResult } from "./results-manager";

export type OnboardingRunAllProgress = {
  phase: "downloading" | "decompressing" | "analyzing" | "complete" | "error";
  loaded: number;
  total: number;
  elapsedSeconds: number;
  processedStudies: number;
  matchCount: number;
  message: string;
};

const ONBOARDING_CATALOG_URL =
  "https://monadic-dna-explorer.nyc3.digitaloceanspaces.com/gwas_catalog_20251117.tsv.gz";

export async function runAllAnalysisOnboarding(
  genotypeData: Map<string, string>,
  onProgress: (progress: OnboardingRunAllProgress) => void,
  hasResult: (studyId: number) => boolean,
  options: { maxResults?: number } = {}
): Promise<SavedResult[]> {
  const startTime = Date.now();

  const emitProgress = (progress: Omit<OnboardingRunAllProgress, "elapsedSeconds">) => {
    onProgress({
      ...progress,
      elapsedSeconds: (Date.now() - startTime) / 1000,
    });
  };

  emitProgress({
    phase: "downloading",
    loaded: 0,
    total: 100,
    processedStudies: 0,
    matchCount: 0,
    message: "Downloading the lightweight study catalog for your preview.",
  });

  const response = await fetch(ONBOARDING_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Failed to download preview catalog: ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Preview catalog download stream was unavailable.");
  }

  let receivedLength = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedLength += value.length;

    emitProgress({
      phase: "downloading",
      loaded: receivedLength,
      total: contentLength || receivedLength,
      processedStudies: 0,
      matchCount: 0,
      message: "Downloading the lightweight study catalog for your preview.",
    });
  }

  const compressed = new Uint8Array(receivedLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  emitProgress({
    phase: "decompressing",
    loaded: 0,
    total: 1,
    processedStudies: 0,
    matchCount: 0,
    message: "Preparing only the columns needed for onboarding.",
  });

  const looksGzipped = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
  const contentEncoding = response.headers.get("content-encoding") || "";
  const shouldDecompress = looksGzipped && !contentEncoding.toLowerCase().includes("gzip");

  let decompressed: Uint8Array;
  if (shouldDecompress) {
    decompressed = pako.ungzip(compressed);
  } else {
    decompressed = compressed;
  }

  const decoder = new TextDecoder("utf-8");

  let headerEndIdx = 0;
  for (let i = 0; i < decompressed.length; i++) {
    if (decompressed[i] === 0x0a || (decompressed[i] === 0x0d && decompressed[i + 1] === 0x0a)) {
      headerEndIdx = i;
      break;
    }
  }

  const headerLine = decoder.decode(decompressed.slice(0, headerEndIdx));
  const headers = headerLine.split("\t");
  const colMap: Record<string, number> = {};
  headers.forEach((header, index) => {
    colMap[header.trim()] = index;
  });

  const idIdx = colMap.id;
  const accessionIdx = colMap.study_accession;
  const traitIdx = colMap.disease_trait;
  const studyIdx = colMap.study;
  const riskAlleleIdx = colMap.strongest_snp_risk_allele;
  const orBetaIdx = colMap.or_or_beta;
  const ciTextIdx = colMap.ci_text;
  const mappedGeneIdx = colMap.mapped_gene;
  const pValueIdx = colMap.p_value;
  const pValueMlogIdx = colMap.pvalue_mlog;
  const sampleSizeIdx = colMap.initial_sample_size;
  const replicationSampleSizeIdx = colMap.replication_sample_size;

  if (
    idIdx === undefined ||
    traitIdx === undefined ||
    studyIdx === undefined ||
    riskAlleleIdx === undefined ||
    orBetaIdx === undefined
  ) {
    throw new Error("Preview catalog schema is missing required columns.");
  }

  const estimatedTotalLines=Math.max(1,Math.floor(decompressed.length/500));
  const pool=new AnalysisPool(),pending=new Set<Promise<void>>(),analysisChunks:SavedResult[][]=[];
  const textDecoder=new TextDecoder('utf-8');
  const now=new Date().toISOString();
  let processedStudies=0,matchCount=0,index=0,failure:unknown;
  const progress=()=>emitProgress({phase:'analyzing',loaded:processedStudies,total:estimatedTotalLines,processedStudies,matchCount,message:'Matching the catalog on your device.'});
  const prepare=(line:string):GWASStudy|null=>{
    const cols=line.split('\t'),id=Number.parseInt(cols[idIdx]||'',10),allele=cols[riskAlleleIdx]?.trim(),size=cols[orBetaIdx]?.trim();
    if(!id || !allele || !size || hasResult(id))return null;
    const [snp,base]=allele.split('-'),gt=genotypeData.get(snp);
    if(!base || !gt || !/^[ACGT]{2}$/.test(gt) || !gt.includes(base))return null;
    return {id,study_accession:cols[accessionIdx]||'',disease_trait:cols[traitIdx]||'Unknown trait',study:cols[studyIdx]||'Unknown study',snps:cols[colMap.snps]||snp,strongest_snp_risk_allele:allele,or_or_beta:size,ci_text:cols[ciTextIdx]||'',p_value:cols[pValueIdx]||'',pvalue_mlog:cols[pValueMlogIdx]||'',mapped_gene:cols[mappedGeneIdx]||'',initial_sample_size:cols[sampleSizeIdx]||'',replication_sample_size:cols[replicationSampleSizeIdx]||''};
  };
  let position=headerEndIdx+(decompressed[headerEndIdx]===0x0d?2:1),leftover='';
  try {
    while(position<decompressed.length){
      if(failure)throw failure;
      const end=Math.min(position+2*1024*1024,decompressed.length);
      const text=leftover+textDecoder.decode(decompressed.subarray(position,end),{stream:end<decompressed.length});
      const newline=end===decompressed.length?text.length:text.lastIndexOf('\n')+1;
      const lines=text.slice(0,newline).split(/\r?\n/).filter(line=>line.trim());
      leftover=text.slice(newline);position=end;
      const studies=lines.map(prepare).filter((row):row is GWASStudy=>row!==null),order=index++;
      const work:Promise<void>=pool.analyze(studies,genotypeData,now).then(rows=>{analysisChunks[order]=rows;processedStudies+=lines.length;matchCount+=rows.length;progress();}).catch(error=>{failure=error;}).finally(()=>pending.delete(work));
      pending.add(work);
      if(pending.size>=pool.concurrency)await Promise.race(pending);
      if(options.maxResults && matchCount>=options.maxResults)break;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    await Promise.all(pending);
    if(failure)throw failure;
    const results=analysisChunks.flat().slice(0,options.maxResults||Infinity);
    emitProgress({phase:'complete',loaded:processedStudies,total:processedStudies,processedStudies,matchCount:results.length,message:'Preview analysis complete.'});
    return results;
  } finally {await Promise.all(pending);pool.close();}
}
