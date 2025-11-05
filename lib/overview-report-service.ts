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
 * Target: ~10 chars per result = ~2.5 tokens per result
 * This allows ~48,000 results per call at 120k token budget
 */
function formatResultsUltraCompact(results: SavedResult[]): string {
  return results
    .map(r => {
      // Ultra-aggressive abbreviation - max 15 chars
      const trait = r.traitName
        .replace(/\b(and|or|the|of|in|for|with|disease|type|risk|syndrome)\b/gi, '')
        .replace(/\s+/g, '')  // Remove ALL spaces
        .substring(0, 15)
        .trim();

      // Single letter risk level
      const level = r.riskLevel === 'increased' ? 'i' :
                    r.riskLevel === 'decreased' ? 'd' : 'n';

      // Format score compactly - handle both small (OR ~0.5-2.0) and large (beta coefficients)
      let score: string;
      if (Math.abs(r.riskScore) < 10) {
        // Small values (OR): Use 2 decimals, remove leading 0
        score = r.riskScore.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.');
      } else {
        // Large values (beta): Use scientific notation or truncate
        score = r.riskScore >= 1000 ? r.riskScore.toExponential(1) : r.riskScore.toFixed(0);
      }

      return `${trait}|${level}|${score}`;
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
  const NUM_GROUPS = 32;  // 32 groups to give reasoning model enough tokens for both thinking + output (~25 min with Ollama)

  try {
    onProgress({
      phase: 'map',
      message: 'Filtering to high-confidence results...',
      progress: 2,
      totalGroups: NUM_GROUPS,
    });

    // Filter to high-confidence results only
    const highConfResults = filterHighConfidence(results);
    console.log(`[Overview Report] Filtered ${results.length} → ${highConfResults.length} high-confidence results (sample≥5k, p≤1e-9)`);

    if (highConfResults.length === 0) {
      throw new Error('No high-confidence results found (sample size ≥5,000 and p-value ≤1e-9)');
    }

    onProgress({
      phase: 'map',
      message: `Analyzing ${highConfResults.length.toLocaleString()} high-confidence results...`,
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

      // Format in ultra-compact format
      const compactResults = formatResultsUltraCompact(group);

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
      // With 32 batches, limit output to fit in reduce phase
      // 32 × 3,500 = 112k tokens (safe for reduce phase)
      // Allows for reasoning + ~2,000 word summary per batch
      const response = await callLLM([{ role: 'user', content: mapPrompt }], {
        maxTokens: 3500,
        temperature: 0.7,
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
    const response = await callLLM([{ role: 'user', content: reducePrompt }], {
      maxTokens: 8000,
      temperature: 0.7,
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
