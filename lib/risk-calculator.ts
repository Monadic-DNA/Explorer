import { parseVariantIds } from './snp-utils';

export type UserStudyResult = {
  hasMatch: boolean;
  userGenotype?: string;
  riskAllele?: string;
  effectSize?: string;
  effectType?: 'OR' | 'beta';
  confidenceInterval?: string;
  riskScore?: number;
  riskLevel?: 'increased' | 'decreased' | 'neutral';
  matchedSnp?: string;
  gwasId?: string;
  allMatches?: Array<{
    snp: string;
    genotype: string;
    score: number;
    level: 'increased' | 'decreased' | 'neutral';
  }>;
};

// Helper function to get complement base
function getComplement(base: string): string {
  const complements: Record<string, string> = {
    'A': 'T',
    'T': 'A',
    'C': 'G',
    'G': 'C'
  };
  return complements[base.toUpperCase()] || base;
}

// Helper function to check if genotype is valid (not a no-call)
export function isValidGenotype(genotype: string): boolean {
  // Filter out no-calls (--, -, 00, etc.)
  return genotype !== '--' &&
         genotype !== '-' &&
         genotype !== '00' &&
         genotype.length > 0 &&
         !/^-+$/.test(genotype);
}

export function calculateRiskScore(
  userGenotype: string,
  riskAllele: string,
  effectSize: string,
  effectType: 'OR' | 'beta' = 'OR'
): {
  score: number;
  level: 'increased' | 'decreased' | 'neutral';
} {
  // Parse effect size (OR or beta)
  const effect = parseFloat(effectSize);
  if (isNaN(effect)) {
    return { score: 1, level: 'neutral' };
  }

  // Check if genotype is valid
  if (!isValidGenotype(userGenotype)) {
    return { score: 1, level: 'neutral' };
  }

  // Extract the risk allele (e.g., "rs123-A" -> "A")
  const riskAlleleBase = riskAllele.split('-').pop() || '';
  const userAlleles = userGenotype.split('');

  // Count how many risk alleles the user has (0, 1, or 2)
  // SECURITY FIX: Remove complement matching per audit recommendation
  // GWAS Catalog and 23andMe both use forward strand, complement matching causes false positives
  const riskAlleleCount = userAlleles.filter(allele => allele === riskAlleleBase).length;

  let riskScore: number;
  let riskLevel: 'increased' | 'decreased' | 'neutral';

  if (effectType === 'OR') {
    // Odds ratio: OR > 1 increases risk, OR < 1 decreases risk (protective)
    // Non-carriers are ALWAYS the reference baseline (1.0) in GWAS studies

    if (effect < 1) {
      // Protective allele (OR < 1)
      if (riskAlleleCount === 0) {
        // No protective alleles = reference baseline
        riskLevel = 'neutral';
        riskScore = 1.0;
      } else {
        // Has protective alleles = decreased risk
        riskLevel = 'decreased';
        riskScore = Math.pow(effect, riskAlleleCount);
      }
    } else if (effect > 1) {
      // Risk-increasing allele (OR > 1)
      if (riskAlleleCount === 0) {
        // No risk alleles = reference baseline
        riskLevel = 'neutral';
        riskScore = 1.0;
      } else {
        // Has risk alleles = increased risk
        riskLevel = 'increased';
        riskScore = Math.pow(effect, riskAlleleCount);
      }
    } else {
      riskLevel = 'neutral';
      riskScore = 1.0;
    }
  } else {
    // Beta coefficient - represents units of trait change, not relative risk
    // Store the actual beta value (effect * alleleCount) for display
    // This should NOT be interpreted as a risk multiplier
    riskScore = effect * riskAlleleCount;
    if (riskAlleleCount === 0) {
      riskLevel = 'neutral';
    } else if (effect > 0) {
      riskLevel = 'increased';
    } else {
      riskLevel = 'decreased';
    }
  }

  // For OR, prevent scores below 0.1; for beta, allow any value including 0
  if (effectType === 'OR') {
    return { score: Math.max(0.1, riskScore), level: riskLevel };
  } else {
    return { score: riskScore, level: riskLevel };
  }
}

export function analyzeStudyClientSide(
  genotypeMap: Map<string, string>,
  studySnps: string,
  riskAllele: string | null,
  effectSize: string | null,
  gwasId: string | null,
  effectType: 'OR' | 'beta' = 'OR',
  confidenceInterval?: string | null
): UserStudyResult {
  if (!riskAllele || !effectSize || !studySnps) {
    return { hasMatch: false };
  }

  // Extract SNP IDs from the study (use cached parser)
  const snpList = parseVariantIds(studySnps);

  // Find ALL matching SNPs (not just the first one)
  const allMatches: Array<{
    snp: string;
    genotype: string;
    score: number;
    level: 'increased' | 'decreased' | 'neutral';
  }> = [];

  for (const snp of snpList) {
    if (genotypeMap.has(snp)) {
      const userGenotype = genotypeMap.get(snp)!;

      // Skip invalid genotypes (no-calls, etc.)
      if (!isValidGenotype(userGenotype)) {
        continue;
      }

      const { score, level } = calculateRiskScore(userGenotype, riskAllele, effectSize, effectType);

      allMatches.push({
        snp,
        genotype: userGenotype,
        score,
        level
      });
    }
  }

  // No matches found
  if (allMatches.length === 0) {
    return { hasMatch: false };
  }

  // Return the first match as the primary result for backward compatibility
  // but include all matches for comprehensive analysis
  const primaryMatch = allMatches[0];

  return {
    hasMatch: true,
    userGenotype: primaryMatch.genotype,
    riskAllele,
    effectSize,
    effectType,
    confidenceInterval: confidenceInterval || undefined,
    riskScore: primaryMatch.score,
    riskLevel: primaryMatch.level,
    matchedSnp: primaryMatch.snp,
    gwasId: gwasId || undefined,
    allMatches: allMatches,
  };
}
