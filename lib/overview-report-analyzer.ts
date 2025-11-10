/**
 * Overview Report Analyzer
 *
 * Utilities for partitioning and analyzing genetic results for comprehensive overview reports.
 * Uses map-reduce pattern: partition results into balanced groups, analyze each group,
 * then synthesize into final comprehensive report.
 */

import type { SavedResult } from './results-manager';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface OverviewStatistics {
  totalResults: number;
  increasedRisk: number;
  increasedRiskPercent: string;
  decreasedRisk: number;
  decreasedRiskPercent: string;
  neutral: number;
  neutralPercent: string;
  topRisks: Array<{ traitName: string; riskScore: number }>;
  topProtective: Array<{ traitName: string; riskScore: number }>;
}

/**
 * Filter results to high-confidence only
 * High confidence criteria (from lib/parsing.ts):
 * - Sample size ≥ 5,000
 * - -log10(p-value) ≥ 9 (p ≤ 1e-9)
 * - No major quality flags (sample < 500 or p > 5e-7)
 */
export function filterToHighConfidence(results: SavedResult[]): SavedResult[] {
  return results.filter(r => {
    // Note: Confidence band would need to be computed from GWAS catalog metadata
    // For now, we'll use all results since the user's export already has quality data
    // In production, you'd join with GWAS catalog to get sample size, p-values
    return true; // Placeholder - actual filtering would happen here
  });
}

/**
 * Partition results into balanced groups for map-reduce analysis
 * Uses stratified sampling to ensure each group has balanced risk distribution
 *
 * @param results - Array of genetic results to partition
 * @param numGroups - Number of groups to create (default: 12 for ~8k results per group)
 * @returns Array of result groups
 */
export function partitionResultsForAnalysis(
  results: SavedResult[],
  numGroups: number = 12
): SavedResult[][] {
  // Sort by effect size (distance from neutral risk score of 1.0)
  // This prioritizes most significant findings
  const sorted = [...results].sort((a, b) => {
    const aDistance = Math.abs(a.riskScore - 1.0);
    const bDistance = Math.abs(b.riskScore - 1.0);
    return bDistance - aDistance;
  });

  // Stratified split: distribute high/medium/low impact evenly across groups
  // Round-robin assignment ensures balanced groups
  const groups: SavedResult[][] = Array.from({ length: numGroups }, () => []);

  sorted.forEach((result, idx) => {
    groups[idx % numGroups].push(result);
  });

  return groups;
}

/**
 * Format results in optimized format for LLM context
 * Format: "TraitName|RiskScore|RiskLevel|EffectType|SNP|Gene"
 * Includes essential medical context (genes, SNPs) with efficient encoding
 * Risk Level encoded as: i=increased, d=decreased, n=neutral
 * Effect Type: OR (odds ratio) or beta (beta coefficient)
 */
export function formatResultsOptimized(results: SavedResult[]): string {
  // TESTING: Temporarily limit to first 1,000 studies per batch
  //const limitedResults = results.slice(0, 1000);

  return results
    .map(r => {
      const trait = r.traitName.substring(0, 60); // Keep reasonable length
      const riskScore = r.riskScore;
      const riskLevel = r.riskLevel.charAt(0); // i/d/n encoding
      const effectType = r.effectType || 'OR'; // Default to OR if not specified
      const snp = r.matchedSnp;
      const gene = r.mappedGene || 'Unknown';

      return `${trait}|${riskScore}|${riskLevel}|${effectType}|${snp}|${gene}`;
    })
    .join('\n');
}

/**
 * Compute overall statistics for reduce phase
 */
export function computeOverviewStatistics(results: SavedResult[]): OverviewStatistics {
  const increasedRisk = results.filter(r => r.riskLevel === 'increased').length;
  const decreasedRisk = results.filter(r => r.riskLevel === 'decreased').length;
  const neutral = results.filter(r => r.riskLevel === 'neutral').length;
  const total = results.length;

  // Get top 5 highest risk (furthest above 1.0)
  const topRisks = [...results]
    .filter(r => r.riskLevel === 'increased')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5)
    .map(r => ({ traitName: r.traitName, riskScore: r.riskScore }));

  // Get top 5 most protective (furthest below 1.0 or most negative for beta)
  const topProtective = [...results]
    .filter(r => r.riskLevel === 'decreased')
    .sort((a, b) => {
      // For OR: lower is more protective
      // For beta: more negative is more protective
      if (a.effectType === 'beta' && b.effectType === 'beta') {
        return a.riskScore - b.riskScore; // More negative first
      }
      return a.riskScore - b.riskScore; // Lower OR first
    })
    .slice(0, 5)
    .map(r => ({ traitName: r.traitName, riskScore: r.riskScore }));

  return {
    totalResults: total,
    increasedRisk,
    increasedRiskPercent: ((increasedRisk / total) * 100).toFixed(1),
    decreasedRisk,
    decreasedRiskPercent: ((decreasedRisk / total) * 100).toFixed(1),
    neutral,
    neutralPercent: ((neutral / total) * 100).toFixed(1),
    topRisks,
    topProtective,
  };
}

/**
 * Build user context string from customization data
 * Used in both map and reduce prompts for personalization
 */
export function buildUserContextString(customization: any): string {
  if (!customization) return '';

  const parts = [];

  if (customization.ethnicities?.length > 0) {
    parts.push(`Ethnicities: ${customization.ethnicities.join(', ')}`);
  }
  if (customization.countriesOfOrigin?.length > 0) {
    parts.push(`Countries of ancestral origin: ${customization.countriesOfOrigin.join(', ')}`);
  }
  if (customization.genderAtBirth) {
    parts.push(`Gender assigned at birth: ${customization.genderAtBirth}`);
  }
  if (customization.age) {
    parts.push(`Age: ${customization.age}`);
  }
  if (customization.smokingHistory) {
    const smokingLabel = customization.smokingHistory === 'still-smoking' ? 'Currently smoking' :
                         customization.smokingHistory === 'past-smoker' ? 'Former smoker' :
                         'Never smoked';
    parts.push(`Smoking history: ${smokingLabel}`);
  }
  if (customization.alcoholUse) {
    const alcoholLabel = customization.alcoholUse.charAt(0).toUpperCase() + customization.alcoholUse.slice(1);
    parts.push(`Alcohol use: ${alcoholLabel}`);
  }
  if (customization.medications?.length > 0) {
    parts.push(`Current medications/supplements: ${customization.medications.join(', ')}`);
  }
  if (customization.diet) {
    const dietLabel = customization.diet === 'regular' ? 'Regular diet (no restrictions)' :
                     customization.diet.charAt(0).toUpperCase() + customization.diet.slice(1) + ' diet';
    parts.push(`Dietary preferences: ${dietLabel}`);
  }
  if (customization.personalConditions?.length > 0) {
    parts.push(`Personal medical history: ${customization.personalConditions.join(', ')}`);
  }
  if (customization.familyConditions?.length > 0) {
    parts.push(`Family medical history: ${customization.familyConditions.join(', ')}`);
  }

  if (parts.length === 0) return '';

  return `\n\n${parts.join('\n')}`;
}

/**
 * Generate map phase prompt for analyzing a subset of results
 */
export function generateMapPrompt(
  groupNumber: number,
  totalGroups: number,
  resultsInGroup: number,
  totalResults: number,
  compactResults: string,
  userContext: string
): string {
  return `Here are genetic traits from GWAS Catalog matched by the Monadic DNA Explorer tool. This is the map phase.
  Please analyze health, lifestyle, appearance, personality and fun facts for the reduce phase.
  Fun facts should actually be fun and not serious medical stuff.
  Do not include tutorial, recommendations, next steps. The output is not meant for the user. Rather, the next reduce phase will be handled by an LLM.
  Remember to base relevance regardless of risk level, i.e. include increased, decreased or neutral entries, so the user gets a holistic picture.
  Output text with no tables or any fancy formatting.
  Do not comment on SNPs and genes I do not have.

USER:${userContext}

BATCH: ${groupNumber} of ${totalGroups} (${resultsInGroup} variants)

DATA FORMAT (one variant per line):
Format: Trait Name|Risk Score|Risk Level|Effect Type|SNP|Gene

Where:
  - Trait Name: Full name of the genetic trait/condition
  - Risk Score: Numerical risk score (e.g., 1100 = 1.1× risk for OR, or actual beta coefficient value)
  - Risk Level: i=increased, d=decreased, n=neutral
  - Effect Type: OR (odds ratio) or beta (beta coefficient)
  - SNP: The specific genetic variant (rs number)
  - Gene: The associated gene name

IMPORTANT: Effect Type tells you how to interpret Risk Score:
  - OR: Odds ratio (1000 = 1.0 = neutral, >1000 = increased risk, <1000 = protective)
  - beta: Beta coefficient (context-dependent, sign indicates direction)

Examples:
  Cortical surface area|1100|i|OR|rs12345678|NFILZ
  Type 2 diabetes|850|d|OR|rs7903146|TCF7L2
  Body mass index|0.05|i|beta|rs9939609|FTO

DATA:

${compactResults}
`;
}

/**
 * Generate reduce phase prompt for synthesizing all group summaries
 */
export function generateReducePrompt(
  totalGroups: number,
  totalResults: number,
  groupSummaries: string[],
  stats: OverviewStatistics,
  userContext: string
): string {
  const summariesText = groupSummaries
    .map((summary, i) => `--- BATCH ${i + 1} ANALYSIS ---\n${summary}`)
    .join('\n\n');

  return `Here are batched analyses of genetic traits from GWAS Catalog matched by the Monadic DNA Explorer tool. I am ${userContext}

Please analyze and produce a five page report (health, lifestyle, appearance, personality, fun facts) suitable for personal genomics users. 

Fun facts should actually be fun and not serious medical stuff. 

Make sure you mention the most salient SNPs and genes. 

Minimize specific medical recommendation or testing recommendations as we do not want to flood the medical system with unnecessary costs. 

Output text with no tables or any fancy formatting. Do not comment on SNPs and genes I do not have. 
${summariesText}`;
}
