// Web Worker for parallel SNP analysis
import { parseVariantIds } from './snp-utils';
import { calculateRiskScore, isValidGenotype } from './risk-calculator';

export type WorkerMessage = {
  type: 'analyze';
  studies: Array<{
    id: number;
    study_accession: string | null;
    disease_trait: string | null;
    study: string | null;
    snps: string | null;
    strongest_snp_risk_allele: string | null;
    or_or_beta: string | null;
  }>;
  genotypeData: [string, string][]; // Map as array for serialization
};

export type WorkerResult = {
  type: 'results';
  results: Array<{
    studyId: number;
    gwasId: string;
    traitName: string;
    studyTitle: string;
    userGenotype: string;
    riskAllele: string;
    effectSize: string;
    riskScore: number;
    riskLevel: 'increased' | 'decreased' | 'neutral';
    matchedSnp: string;
  }>;
  matchCount: number;
  processedCount: number;
};

export type WorkerProgress = {
  type: 'progress';
  processed: number;
  total: number;
  matchCount: number;
};

// Worker message handler
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, studies, genotypeData } = e.data;

  if (type !== 'analyze') return;

  // Reconstruct Map from array
  const genotypeMap = new Map(genotypeData);

  const results: WorkerResult['results'] = [];
  let matchCount = 0;
  let processedCount = 0;
  const totalStudies = studies.length;

  console.log(`Worker starting: ${totalStudies} studies to process`);

  // Send initial progress
  self.postMessage({
    type: 'progress',
    processed: 0,
    total: totalStudies,
    matchCount: 0,
  } as WorkerProgress);

  for (let i = 0; i < studies.length; i++) {
    const study = studies[i];

    // Send progress updates every 500 studies for more frequent updates
    if (i > 0 && i % 500 === 0) {
      const progress: WorkerProgress = {
        type: 'progress',
        processed: i,
        total: totalStudies,
        matchCount,
      };
      self.postMessage(progress);
    }

    // Quick filter: check if has SNPs matching user
    if (!study.snps) {
      continue;
    }

    const snpList = parseVariantIds(study.snps);
    const hasMatch = snpList.some(snp => genotypeMap.has(snp));

    if (!hasMatch) {
      continue;
    }

    processedCount++;

    // Skip if no risk allele or effect size
    if (!study.strongest_snp_risk_allele || !study.or_or_beta) {
      continue;
    }

    // Perform analysis
    for (const snp of snpList) {
      if (genotypeMap.has(snp)) {
        const userGenotype = genotypeMap.get(snp)!;

        if (!isValidGenotype(userGenotype)) {
          continue;
        }

        const { score, level } = calculateRiskScore(
          userGenotype,
          study.strongest_snp_risk_allele,
          study.or_or_beta,
          'OR'
        );

        results.push({
          studyId: study.id,
          gwasId: study.study_accession || '',
          traitName: study.disease_trait || 'Unknown trait',
          studyTitle: study.study || 'Unknown study',
          userGenotype,
          riskAllele: study.strongest_snp_risk_allele,
          effectSize: study.or_or_beta,
          riskScore: score,
          riskLevel: level,
          matchedSnp: snp,
        });
        matchCount++;
        break; // Only take first match per study
      }
    }
  }

  // Send results back
  const result: WorkerResult = {
    type: 'results',
    results,
    matchCount,
    processedCount,
  };

  self.postMessage(result);
};
