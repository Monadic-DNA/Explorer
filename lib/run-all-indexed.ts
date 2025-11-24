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

      // Skip if no risk allele or effect size
      if (!study.strongest_snp_risk_allele || !study.or_or_beta) continue;

      // CRITICAL FIX: Extract BOTH SNP ID and allele from risk allele
      // Only match if user has the SPECIFIC SNP with the SPECIFIC allele
      const riskAlleleParts = study.strongest_snp_risk_allele.split('-');
      const riskSnpId = riskAlleleParts[0];
      const riskAlleleBase = riskAlleleParts[1];

      if (!riskSnpId || !riskAlleleBase) continue;

      // Check if user has the specific SNP mentioned in the risk allele
      const userGenotype = genotypeData.get(riskSnpId);
      if (!userGenotype) continue;

      // Check if user has the specific allele for this SNP
      if (!userGenotype.includes(riskAlleleBase)) continue;

      // Perform analysis (now we know user has the correct SNP with the correct allele)
      // Basic genotype validation
      if (!/^[ACGT]{2}$/.test(userGenotype)) continue;

      // Calculate risk score using the validated genotype
      const riskAlleleCount = userGenotype.split('').filter(a => a === riskAlleleBase).length;
      const effectValue = parseFloat(study.or_or_beta);

      // Detect effect type (beta coefficient vs odds ratio)
      // Beta coefficients have "increase" or "decrease" in CI text
      // e.g., "[NR] unit increase", "[0.0068-0.0139] unit increase", "[112.27-112.33] increase"
      // Odds ratios are just numbers: e.g., "[1.08-1.15]"
      const ciTextLower = study.ci_text?.toLowerCase() ?? '';
      const hasIncrease = ciTextLower.includes('increase');
      const hasDecrease = ciTextLower.includes('decrease');
      const isBeta = hasIncrease || hasDecrease;
      const effectType: 'OR' | 'beta' = isBeta ? 'beta' : 'OR';

      // CRITICAL FIX: GWAS Catalog stores ALL beta values as positive numbers
      // Direction is encoded in ci_text ("increase" vs "decrease")
      // We must negate the value for "decrease" studies
      let adjustedEffect = effectValue;
      if (isBeta && hasDecrease && !hasIncrease) {
        adjustedEffect = -Math.abs(effectValue); // Force negative for decrease
      }

      let riskScore = 1.0;
      let riskLevel: 'increased' | 'decreased' | 'neutral' = 'neutral';

      if (!isNaN(adjustedEffect) && adjustedEffect !== 0) {
        if (effectType === 'OR') {
          // Odds ratio logic
          if (riskAlleleCount === 0) {
            riskScore = 1.0;
            riskLevel = 'neutral';
          } else {
            riskScore = Math.pow(adjustedEffect, riskAlleleCount);
            riskLevel = adjustedEffect > 1 ? 'increased' : adjustedEffect < 1 ? 'decreased' : 'neutral';
          }
        } else {
          // Beta coefficient logic - store actual beta value (now correctly signed)
          riskScore = adjustedEffect * riskAlleleCount;
          if (riskAlleleCount === 0) {
            riskLevel = 'neutral';
          } else {
            riskLevel = adjustedEffect > 0 ? 'increased' : adjustedEffect < 0 ? 'decreased' : 'neutral';
          }
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
          effectType,
          riskScore,
          riskLevel,
          matchedSnp: riskSnpId,
          analysisDate: new Date().toISOString(),
          pValue: study.p_value || undefined,
          pValueMlog: study.pvalue_mlog || undefined,
          mappedGene: study.mapped_gene || undefined,
          sampleSize: study.initial_sample_size || undefined,
          replicationSampleSize: study.replication_sample_size || undefined,
        });
        totalMatchCount++;
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
