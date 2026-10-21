// IndexedDB-based Run All implementation
import {AnalysisPool} from './analysis-pool';
import { gwasDB } from './gwas-db';
import type { SavedResult } from './results-manager';

export type RunAllProgress = {
  phase: 'downloading' | 'decompressing' | 'parsing' | 'storing' | 'analyzing' | 'embeddings' | 'complete' | 'error';
  loaded: number;
  total: number;
  elapsedSeconds: number;
  matchingStudies: number;
  matchCount: number;
  embeddingProgress?: { current: number; total: number }; // For embedding generation phase
};

export async function runAllAnalysisIndexed(
  genotypeData: Map<string, string>,
  onProgress: (progress: RunAllProgress) => void,
  hasResult: (studyId: number) => boolean
): Promise<SavedResult[]> {
  const startTime = Date.now();

  // Check if catalog is cached
  const metadata = await gwasDB.getMetadata();

  if (!metadata) {
    // Download and cache catalog
    await gwasDB.downloadAndStore(
      'https://monadic-dna-explorer.nyc3.digitaloceanspaces.com/gwas_catalog_20251117.tsv.gz',
      (progress) => {
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        onProgress({
          phase: progress.phase as any,
          loaded: progress.loaded,
          total: progress.total,
          elapsedSeconds,
          matchingStudies: 0,
          matchCount: 0,
        });
      }
    );
  } else {
    console.log('Using cached GWAS catalog from IndexedDB');
  }

  // Get study count without loading all data
  console.log('Getting study count from IndexedDB...');
  onProgress({
    phase: 'analyzing',
    loaded: 0,
    total: 100,
    elapsedSeconds: (Date.now() - startTime) / 1000,
    matchingStudies: 0,
    matchCount: 0,
  });

  const totalStudies = await gwasDB.getStudyCount();

  console.log('Total studies in IndexedDB:', totalStudies);

  if (totalStudies === 0) {
    throw new Error('No studies found in IndexedDB. Cache may be corrupted.');
  }

  onProgress({
    phase: 'analyzing',
    loaded: 0,
    total: totalStudies,
    elapsedSeconds: (Date.now() - startTime) / 1000,
    matchingStudies: 0,
    matchCount: 0,
  });

  // Bulk IndexedDB reads overlap a bounded pool of workers. Results stay in catalog
  // order even when workers finish out of order, and no worker receives the full genome.
  const pool=new AnalysisPool();
  const chunks:SavedResult[][]=[];
  const pending=new Set<Promise<void>>();
  let totalProcessed=0,totalMatchCount=0,index=0;
  const now=new Date().toISOString();
  const progress=()=>onProgress({phase:'analyzing',loaded:totalProcessed,total:totalStudies,elapsedSeconds:(Date.now()-startTime)/1000,matchingStudies:totalProcessed,matchCount:totalMatchCount});
  let failure:unknown;
  try {
    for await(const batch of gwasDB.streamStudies(10000)) {
      if(failure)throw failure;
      const candidates=batch.filter(study=>!hasResult(study.id));
      const position=index++;
      const work:Promise<void>=pool.analyze(candidates,genotypeData,now).then(rows=>{
        chunks[position]=rows;totalProcessed+=batch.length;totalMatchCount+=rows.length;progress();
      }).catch(error=>{failure=error;}).finally(()=>{pending.delete(work);});
      pending.add(work);
      if(pending.size>=pool.concurrency)await Promise.race(pending);
    }
    await Promise.all(pending);
    if(failure)throw failure;
    const allResults=chunks.flat();
    onProgress({phase:'complete',loaded:totalProcessed,total:totalProcessed,elapsedSeconds:(Date.now()-startTime)/1000,matchingStudies:totalProcessed,matchCount:allResults.length});
    return allResults;
  } finally {await Promise.all(pending);pool.close();}
}
