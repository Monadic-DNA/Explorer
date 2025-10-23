// IndexedDB-based Run All implementation
import { gwasDB, type GWASStudy } from './gwas-db';
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
      'https://monadoc-dna-explorer.nyc3.digitaloceanspaces.com/gwas_catalog_v1.0.2-associations_e115_r2025-09-15.tsv.gz',
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

  // Process sequentially in small batches to minimize memory
  console.log(`Processing ${totalStudies} studies sequentially in batches`);

  const allResults: SavedResult[] = [];
  let totalMatchCount = 0;
  let totalProcessed = 0;

  // Stream and process in small batches
  let lastProgressUpdate = Date.now();

  for await (const studyBatch of gwasDB.streamStudies(10000)) {
    // Process this batch inline (no workers)
    for (const study of studyBatch) {
      totalProcessed++;

      // Progress update every 500ms for smooth elapsed time
      const now = Date.now();
      if (now - lastProgressUpdate >= 500) {
        const elapsedSeconds = (now - startTime) / 1000;
        onProgress({
          phase: 'analyzing',
          loaded: totalProcessed,
          total: totalStudies,
          elapsedSeconds,
          matchingStudies: totalProcessed,
          matchCount: totalMatchCount,
        });
        lastProgressUpdate = now;
      }

      // Quick filter: check if has SNPs matching user
      if (!study.snps) continue;

      const snpList = study.snps.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      const hasMatch = snpList.some(snp => genotypeData.has(snp));

      if (!hasMatch) continue;

      // Skip if no risk allele or effect size
      if (!study.strongest_snp_risk_allele || !study.or_or_beta) continue;

      // Perform analysis
      for (const snp of snpList) {
        if (genotypeData.has(snp)) {
          const userGenotype = genotypeData.get(snp)!;

          // Basic genotype validation
          if (!/^[ACGT]{2}$/.test(userGenotype)) continue;

          // Simple risk score calculation
          const riskAllele = study.strongest_snp_risk_allele.split('-').pop() || '';
          const hasRiskAllele = userGenotype.includes(riskAllele);

          let riskScore = 1.0;
          let riskLevel: 'increased' | 'decreased' | 'neutral' = 'neutral';

          if (hasRiskAllele) {
            const orValue = parseFloat(study.or_or_beta);
            if (!isNaN(orValue) && orValue > 0) {
              riskScore = orValue;
              riskLevel = orValue > 1 ? 'increased' : orValue < 1 ? 'decreased' : 'neutral';
            }
          }

          if (!hasResult(study.id)) {
            allResults.push({
              studyId: study.id,
              gwasId: study.study_accession || '',
              traitName: study.disease_trait || 'Unknown trait',
              studyTitle: study.study || 'Unknown study',
              userGenotype,
              riskAllele: study.strongest_snp_risk_allele,
              effectSize: study.or_or_beta,
              riskScore,
              riskLevel,
              matchedSnp: snp,
              analysisDate: new Date().toISOString(),
            });
            totalMatchCount++;
          }
          break; // Only first match per study
        }
      }
    }

    console.log(`Batch complete. Total processed: ${totalProcessed}/${totalStudies}, Total matches: ${totalMatchCount}`);

    // Send progress update after each batch
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    onProgress({
      phase: 'analyzing',
      loaded: totalProcessed,
      total: totalStudies,
      elapsedSeconds,
      matchingStudies: totalProcessed,
      matchCount: totalMatchCount,
    });

    // Allow UI to update between batches
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  console.log(`Exited batch loop. Total processed: ${totalProcessed}/${totalStudies}`);
  console.log(`Analysis complete! Processed: ${totalProcessed}, Matches: ${totalMatchCount}`);

  // Send one final progress update before completing
  const finalElapsedSeconds = (Date.now() - startTime) / 1000;
  onProgress({
    phase: 'analyzing',
    loaded: totalProcessed,
    total: totalStudies,
    elapsedSeconds: finalElapsedSeconds,
    matchingStudies: totalProcessed,
    matchCount: totalMatchCount,
  });

  // Small delay to ensure final progress renders
  await new Promise(resolve => setTimeout(resolve, 100));

  // Complete
  console.log('Sending completion update...');
  onProgress({
    phase: 'complete',
    loaded: totalProcessed,
    total: totalProcessed,
    elapsedSeconds: finalElapsedSeconds,
    matchingStudies: totalProcessed,
    matchCount: totalMatchCount,
  });

  console.log(`Returning ${allResults.length} results`);
  return allResults;
}
