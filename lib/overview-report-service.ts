/**
 * Overview Report Service - CLIENT-SIDE ONLY
 *
 * Generates comprehensive genetic overview reports entirely in the browser.
 * Privacy-first: No sensitive data leaves the client except via nilAI TEE.
 *
 * Architecture for 92,041 high-quality results:
 * 1. Partition into 4 groups of ~23k each (ultra-compact format: ~10 chars/result)
 * 2. Map phase: Analyze each group sequentially with 6s delays (4 nilAI calls)
 * 3. Reduce phase: Synthesize summaries (1 nilAI call)
 * Total: 5 LLM calls, ~30 seconds (18s delays + ~12s inference)
 * Rate limits respected: 10/min, 100/hour, 500/day
 */

import type { SavedResult } from './results-manager';
import {
  partitionResultsForAnalysis,
  computeOverviewStatistics,
  buildUserContextString,
  generateMapPrompt,
  generateReducePrompt,
  type OverviewStatistics,
} from './overview-report-analyzer';
import { callLLM } from './llm-client';

/**
 * Ultra-compact format to fit within context window
 * Format: "TraitAbbrev|L|score" where L = i/d/n (increased/decreased/neutral)
 * Target: ~12 chars per result = ~3 tokens per result
 * This allows ~40,000 results per call at 120k token budget
 */
/**
 * Format results in optimized format for LLM analysis
 * Format: Trait Name|Risk Score|Risk Level|Effect Type|SNP|Gene
 * Includes essential medical context with efficient encoding
 */
function formatResultsOptimized(results: SavedResult[]): string {
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

export interface GroupSummary {
  groupNumber: number;
  summary: string;
}

export interface ProgressUpdate {
  phase: 'map' | 'reduce' | 'complete' | 'error';
  message: string;
  progress: number;  // 0-100
  currentGroup?: number;
  totalGroups?: number;
  groupSummary?: string;
  groupSummaries?: GroupSummary[];
  finalReport?: string;
  error?: string;
  estimatedTimeRemaining?: number;  // seconds
  averageTimePerGroup?: number;  // seconds
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// Rate limiting: 10 calls per minute
const DELAY_BETWEEN_CALLS_MS = 6000; // 6 seconds

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate comprehensive overview report - CLIENT-SIDE ONLY
 * All processing happens in the browser for privacy
 */
/**
 * Calculate optimal batch count based on dataset size and token constraints.
 * Ensures reduce phase stays well under token limit with 15k buffer.
 */
function calculateOptimalBatches(highConfResultCount: number): number {
  // Token budget for reduce phase (with reasoning model, low effort)
  const CONTEXT_WINDOW = 131072;
  const REASONING_TOKENS_LOW = 5000;
  const OUTPUT_TOKENS = 20000;  // Increased for comprehensive final reports
  const TARGET_BUFFER = 10000;  // Tightened for maximum context utilization
  const SUMMARY_TOKENS_PER_BATCH = 6400;  // Maxed out for rich per-batch summaries

  // Calculate max safe batches based on token budget
  const availableForSummaries =
    CONTEXT_WINDOW - REASONING_TOKENS_LOW - OUTPUT_TOKENS - TARGET_BUFFER;
  const maxSafeBatches = Math.floor(availableForSummaries / SUMMARY_TOKENS_PER_BATCH);
  // Result: 28 batches max

  // Quality constraints
  const MIN_BATCHES = 4;  // Need thematic diversity
  const MAX_BATCHES = 32;

  // Target results per batch for optimal quality
  // Map phase token budget: 100k nilAI limit - 13k output - 10k buffer = 77k tokens
  // Measured: ~26 tokens/result → ~3,000 results max per batch
  const MIN_RESULTS_PER_BATCH = 800;
  const MAX_RESULTS_PER_BATCH = 3000; // Tuned for nilAI's 100k token limit

  // Calculate batches to maximize results per batch (minimize total API calls)
  const optimalBatches = Math.max(
    MIN_BATCHES,
    Math.min(MAX_BATCHES, Math.ceil(highConfResultCount / MAX_RESULTS_PER_BATCH))
  );

  const resultsPerBatch = Math.ceil(highConfResultCount / optimalBatches);
  const estimatedTokensPerBatch = resultsPerBatch * 26 + 5000; // 26 tokens/result (was 24) + 5k overhead

  console.log(`[Overview Report] Dynamic batch calculation:
    High-confidence results: ${highConfResultCount.toLocaleString()}
    Optimal batches: ${optimalBatches}
    Results per batch: ${resultsPerBatch.toLocaleString()}
    Estimated map tokens/batch: ${estimatedTokensPerBatch.toLocaleString()} (~${Math.round(estimatedTokensPerBatch / 100000 * 100)}% of 100k nilAI limit)
    Estimated reduce tokens: ${optimalBatches * SUMMARY_TOKENS_PER_BATCH + REASONING_TOKENS_LOW + OUTPUT_TOKENS}
    Token buffer: ${CONTEXT_WINDOW - (optimalBatches * SUMMARY_TOKENS_PER_BATCH + REASONING_TOKENS_LOW + OUTPUT_TOKENS)}`);

  return optimalBatches;
}

/**
 * Filter to high-confidence results only
 * Criteria: sample size >= 5,000 AND -log10(p-value) >= 9 (p <= 1e-9)
 */
function filterHighConfidence(results: SavedResult[]): SavedResult[] {
  return results.filter(r => {
    // Parse sample size - handle formats like "72,390" or "up to 72,390 Japanese ancestry"
    const sampleMatch = r.sampleSize?.match(/[\d,]+/);
    const sampleSize = sampleMatch ? parseInt(sampleMatch[0].replace(/,/g, '')) : 0;

    // Parse p-value -log10
    const pValueMlog = r.pValueMlog ? parseFloat(r.pValueMlog) : 0;

    // High confidence: sample >= 5000 AND -log10(p) >= 9
    return sampleSize >= 5000 && pValueMlog >= 9;
  });
}

export async function generateOverviewReport(
  results: SavedResult[],
  customization: any,
  onProgress: ProgressCallback
): Promise<string> {
  try {
    onProgress({
      phase: 'map',
      message: 'Filtering to high-confidence results...',
      progress: 2,
    });

    // Filter to high-confidence results only
    const highConfResults = filterHighConfidence(results);
    console.log(`[Overview Report] Filtered ${results.length} → ${highConfResults.length} high-confidence results (sample≥5k, p≤1e-9)`);

    if (highConfResults.length === 0) {
      throw new Error('No high-confidence results found (sample size ≥5,000 and p-value ≤1e-9)');
    }

    // Calculate optimal batch count dynamically based on result count
    const NUM_GROUPS = calculateOptimalBatches(highConfResults.length);

    onProgress({
      phase: 'map',
      message: `Analyzing ${highConfResults.length.toLocaleString()} high-confidence results in ${NUM_GROUPS} batches...`,
      progress: 5,
      totalGroups: NUM_GROUPS,
    });

    // Partition high-confidence results
    const groups = partitionResultsForAnalysis(highConfResults, NUM_GROUPS);
    console.log(`[Overview Report] Partitioned ${highConfResults.length} results into ${groups.length} groups`);

    // Compute statistics for reduce phase (use high-conf results)
    const stats = computeOverviewStatistics(highConfResults);

    // Build user context
    const userContext = buildUserContextString(customization);

    // MAP PHASE: Analyze each group
    const groupSummaries: string[] = [];
    const completedSummaries: GroupSummary[] = [];
    const groupTimings: number[] = []; // Track timing for ETA calculation

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupNumber = i + 1;
      const groupStartTime = Date.now();
      const progressPercent = 5 + Math.floor((i / groups.length) * 75); // 5-80%

      // Calculate ETA based on completed groups
      let estimatedTimeRemaining: number | undefined;
      let averageTimePerGroup: number | undefined;
      if (groupTimings.length > 0) {
        averageTimePerGroup = groupTimings.reduce((a, b) => a + b, 0) / groupTimings.length / 1000; // seconds
        const remainingGroups = groups.length - i;
        estimatedTimeRemaining = Math.ceil(averageTimePerGroup * remainingGroups);
      }

      onProgress({
        phase: 'map',
        message: `Analyzing group ${groupNumber} of ${NUM_GROUPS} (${group.length.toLocaleString()} traits)...`,
        progress: progressPercent,
        currentGroup: groupNumber,
        totalGroups: NUM_GROUPS,
        estimatedTimeRemaining,
        averageTimePerGroup,
      });

      // Format in optimized format
      const compactResults = formatResultsOptimized(group);

      console.log(`[Overview Report] Compact results sample (first 200 chars): ${compactResults.substring(0, 200)}`);
      console.log(`[Overview Report] Compact results length: ${compactResults.length} chars for ${group.length} results = ${(compactResults.length / group.length).toFixed(1)} chars/result`);

      // Generate map prompt
      const mapPrompt = generateMapPrompt(
        groupNumber,
        NUM_GROUPS,
        group.length,
        highConfResults.length,
        compactResults,
        userContext
      );

      console.log(`[Overview Report] Map phase ${groupNumber}/${NUM_GROUPS}: Calling LLM...`);
      console.log(`[Overview Report] Prompt length: ${mapPrompt.length} chars, ~${Math.ceil(mapPrompt.length / 4)} tokens`);

      // Call LLM using centralized client
      // Use HIGH reasoning effort for complex pattern recognition across variants
      // TESTING: Temporarily limit max tokens to 1,300
      const response = await callLLM([{ role: 'user', content: mapPrompt }], {
        temperature: 0.4,
        reasoningEffort: 'low',
        maxTokens: 13000,
      });

      const summary = response.content;

      if (!summary) {
        throw new Error(`Map phase ${groupNumber} produced no summary`);
      }

      // Track timing for this group
      const groupEndTime = Date.now();
      const groupDuration = groupEndTime - groupStartTime;
      groupTimings.push(groupDuration);

      console.log(`[Overview Report] Map phase ${groupNumber}/${NUM_GROUPS}: Success (${summary.length} chars, ${(groupDuration / 1000).toFixed(1)}s)`);
      groupSummaries.push(summary);

      // Track completed summaries for display to user
      completedSummaries.push({
        groupNumber: groupNumber,
        summary: summary,
      });

      // Calculate updated ETA based on all completed groups
      const avgTime = groupTimings.reduce((a, b) => a + b, 0) / groupTimings.length / 1000; // seconds
      const remainingGroups = groups.length - groupNumber;
      const eta = remainingGroups > 0 ? Math.ceil(avgTime * remainingGroups) : 0;

      onProgress({
        phase: 'map',
        message: `Completed group ${groupNumber} of ${NUM_GROUPS}`,
        progress: progressPercent + Math.floor(75 / NUM_GROUPS),
        currentGroup: groupNumber,
        totalGroups: NUM_GROUPS,
        groupSummary: summary,
        groupSummaries: [...completedSummaries], // Send copy of all completed summaries
        estimatedTimeRemaining: eta,
        averageTimePerGroup: avgTime,
      });

      // No rate limiting needed for local Ollama - process next batch immediately
    }

    // REDUCE PHASE: Synthesize all summaries
    onProgress({
      phase: 'reduce',
      message: 'Synthesizing comprehensive report...',
      progress: 85,
    });

    console.log('[Overview Report] Reduce phase: Starting synthesis...');

    const reducePrompt = generateReducePrompt(
      NUM_GROUPS,
      highConfResults.length,
      groupSummaries,
      stats,
      userContext
    );

    console.log(`[Overview Report] Reduce prompt length: ${reducePrompt.length} chars, ~${Math.ceil(reducePrompt.length / 4)} tokens`);

    // Call LLM for final synthesis using centralized client
    // Use LOW reasoning effort to stay under token limit
    // No maxTokens limit - let model generate comprehensive reports
    const response = await callLLM([{ role: 'user', content: reducePrompt }], {
      temperature: 0.2,
      reasoningEffort: 'medium',
      maxTokens: 25000,
    });

    const finalReport = response.content;

    if (!finalReport) {
      throw new Error('Reduce phase produced no final report');
    }

    console.log(`[Overview Report] Reduce phase: Success (${finalReport.length} chars)`);

    onProgress({
      phase: 'complete',
      message: 'Report generated successfully!',
      progress: 100,
      finalReport,
    });

    return finalReport;
  } catch (error) {
    console.error('[Overview Report] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    onProgress({
      phase: 'error',
      message: 'Generation failed',
      progress: 0,
      error: errorMessage,
    });

    throw error;
  }
}
