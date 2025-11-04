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
 * Format results in compact format for LLM context
 * Format: "TraitName|RiskLevel|RiskScore|SNP"
 * Reduces token usage while preserving essential information
 */
export function formatResultsCompact(results: SavedResult[]): string {
  return results
    .map(r => {
      const trait = r.traitName.substring(0, 80); // Truncate very long trait names
      return `${trait}|${r.riskLevel}|${r.riskScore}|${r.matchedSnp}`;
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
  return `Here are genetic traits from GWAS Catalog matched by the Monadic DNA Explorer tool. I am${userContext}

This is batch ${groupNumber} of ${totalGroups}. For now, only analyze data and produce a 5,000 word intermediate report.

Analysis from all batches will be aggregated and recommendations and advice will be handled later. The overall analysis will only have access to these reports and no other data source.

DATA FORMAT:
Trait Name|Effect Size|Effect Type|Risk Score|Risk Level|Matched SNP|P-Value|Mapped Gene

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

  return `Here are batched analyses of genetic traits from GWAS Catalog matched by the Monadic DNA Explorer tool. I am${userContext}

Please analyze and produce a comprehensive 5,000 word report. Refrain from providing specific medical advice.

${summariesText}`;
}
