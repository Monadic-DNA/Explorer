import { coreCall } from "./core";

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
  return coreCall("partition_results", { results, groups: numGroups });
}

export function formatResultsOptimized(results: SavedResult[]): string { return coreCall("format_results", results); }
export function computeOverviewStatistics(results: SavedResult[]): OverviewStatistics { return coreCall("overview_statistics", results); }

/**
 * Build user context string from customization data
 * Used in both map and reduce prompts for personalization
 */
export function buildUserContextString(customization: any): string {
  return coreCall("user_context", customization);
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
  return coreCall("render_prompt", { name: "generateMapPrompt", values: { groupNumber, totalGroups, resultsInGroup, totalResults, compactResults, userContext } });
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
  return coreCall("render_prompt", { name: "generateReducePrompt", values: { totalGroups, totalResults, groupSummaries, stats, userContext } });
}
