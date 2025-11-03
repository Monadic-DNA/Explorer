/**
 * Overview Report Service - OpenAI Version (CLIENT-SIDE ONLY)
 *
 * Generates comprehensive genetic overview reports entirely in the browser.
 * Uses OpenAI API directly instead of nilAI for testing/debugging.
 *
 * Architecture for 92,041 high-quality results:
 * 1. Partition into 15 groups of ~6,133 each (ultra-compact format: ~12 chars/result)
 * 2. Map phase: Analyze each group sequentially with delays (15 OpenAI calls)
 * 3. Reduce phase: Synthesize summaries (1 OpenAI call)
 * Total: 16 LLM calls (~18-24k tokens per call, well under 128k limit)
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

export interface ProgressUpdate {
  phase: 'map' | 'reduce' | 'complete' | 'error';
  message: string;
  progress: number;  // 0-100
  currentGroup?: number;
  totalGroups?: number;
  groupSummary?: string;
  finalReport?: string;
  error?: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// Rate limiting: Conservative delay for API
const DELAY_BETWEEN_CALLS_MS = 2000; // 2 seconds

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/**
 * Generate comprehensive overview report - CLIENT-SIDE ONLY
 * All processing happens in the browser for privacy
 */
export async function generateOverviewReport(
  results: SavedResult[],
  customization: any,
  onProgress: ProgressCallback
): Promise<string> {
  // Increased to 15 groups to stay under 128k token limit
  // With ~92k results: 92k/15 = ~6,133 results per group
  // At ~12 chars/result: 6,133 * 12 = 73,596 chars = ~18,400 tokens
  // Plus prompt (~5k tokens) = ~23,400 tokens per call
  const NUM_GROUPS = 15;

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

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupNumber = i + 1;
      const progressPercent = 5 + Math.floor((i / groups.length) * 75); // 5-80%

      onProgress({
        phase: 'map',
        message: `Analyzing group ${groupNumber} of ${NUM_GROUPS} (${group.length.toLocaleString()} traits)...`,
        progress: progressPercent,
        currentGroup: groupNumber,
        totalGroups: NUM_GROUPS,
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

      console.log(`[Overview Report] Map phase ${groupNumber}/${NUM_GROUPS}: Calling OpenAI...`);
      console.log(`[Overview Report] Prompt length: ${mapPrompt.length} chars, ~${Math.ceil(mapPrompt.length / 4)} tokens`);

      // Call OpenAI via server endpoint
      const response = await fetch('/api/openai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: mapPrompt }],
          max_tokens: 1500,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`OpenAI API error: ${errorData.error || response.statusText}`);
      }

      const data = await response.json();
      const summary = data.content;

      if (!summary) {
        throw new Error(`Map phase ${groupNumber} produced no summary`);
      }

      console.log(`[Overview Report] Map phase ${groupNumber}/${NUM_GROUPS}: Success (${summary.length} chars)`);
      groupSummaries.push(summary);

      onProgress({
        phase: 'map',
        message: `Completed group ${groupNumber} of ${NUM_GROUPS}`,
        progress: progressPercent + Math.floor(75 / NUM_GROUPS),
        currentGroup: groupNumber,
        totalGroups: NUM_GROUPS,
        groupSummary: summary,
      });

      // Rate limiting: Wait before next call (except after last group)
      if (i < groups.length - 1) {
        onProgress({
          phase: 'map',
          message: `Waiting 2 seconds...`,
          progress: progressPercent + Math.floor(75 / NUM_GROUPS),
          currentGroup: groupNumber,
          totalGroups: NUM_GROUPS,
        });
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
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

    // Call OpenAI for final synthesis
    const response = await fetch('/api/openai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: reducePrompt }],
        max_tokens: 4000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`OpenAI API error: ${errorData.error || response.statusText}`);
    }

    const data = await response.json();
    const finalReport = data.content;

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
