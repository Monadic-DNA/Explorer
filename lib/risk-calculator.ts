import { coreCall } from "./core";
import { parseVariantIds } from "./snp-utils";

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

export function determineEffectTypeAndSize(orOrBeta: string | null, ciText: string | null): { effectType: 'OR' | 'beta'; effectSize: string } {
  return coreCall("effect", { value: orOrBeta, ci: ciText });
}
export function isValidGenotype(genotype: string): boolean { return coreCall("valid_genotype", genotype); }
export function calculateRiskScore(userGenotype: string, riskAllele: string, effectSize: string, effectType: 'OR' | 'beta' = 'OR'): { score: number; level: 'increased' | 'decreased' | 'neutral' } {
  return coreCall("risk_score", { genotype: userGenotype, riskAllele, effectSize, effectType });
}
export function analyzeStudyClientSide(genotypeMap: Map<string, string>, studySnps: string, riskAllele: string | null, effectSize: string | null, gwasId: string | null, effectType: 'OR' | 'beta' = 'OR', confidenceInterval?: string | null): UserStudyResult {
  // Send only relevant variants across the WASM boundary, never the full genome per study.
  const genotypes = Object.fromEntries(parseVariantIds(studySnps).filter(snp => genotypeMap.has(snp)).map(snp => [snp, genotypeMap.get(snp)]));
  return coreCall("analyze_study", { genotypes, snps: studySnps, riskAllele, effectSize, gwasId, effectType, confidenceInterval });
}
