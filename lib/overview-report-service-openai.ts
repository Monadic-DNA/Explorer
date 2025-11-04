/**
 * Overview Report Service (CLIENT-SIDE ONLY)
 *
 * Generates comprehensive genetic overview reports entirely in the browser.
 * Uses local gpt-oss:20b model via Ollama for private, free analysis.
 *
 * Architecture for ~92k high-confidence results:
 * 1. Partition into 20 groups of ~4,600 each (pipe-delimited format)
 * 2. Map phase: Analyze serially with 3,000-word intermediate reports (20 calls, one at a time)
 * 3. Reduce phase: Synthesize intermediate reports into 5,000-word final report (1 call)
 * Total: 21 LLM calls (completes in ~60-90 minutes with real-time progress)
 * Includes appendix with all 20 detailed batch analyses for full context
 * Format: "Trait Name|Effect Size|Effect Type|Risk Score|Risk Level|Matched SNP|P-Value|Mapped Gene"
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
 * Format results in pipe-delimited format with selected columns
 * Format: "Trait Name|Effect Size|Effect Type|Risk Score|Risk Level|Matched SNP|P-Value|Mapped Gene"
 */
function formatResultsPipeDelimited(results: SavedResult[]): string {
  return results
    .map(r => {
      const traitName = r.traitName;
      const effectSize = r.effectType === 'beta' ? r.riskScore.toFixed(3) : r.riskScore.toFixed(2);
      const effectType = r.effectType || 'OR';
      const riskScore = r.riskScore.toFixed(3);
      const riskLevel = r.riskLevel;
      const matchedSnp = r.matchedSnp || 'N/A';
      const pValue = r.pValueMlog || 'N/A';
      const mappedGene = r.mappedGene || 'Unknown';

      return `${traitName}|${effectSize}|${effectType}|${riskScore}|${riskLevel}|${matchedSnp}|${pValue}|${mappedGene}`;
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
  groupSummaries: GroupSummary[];  // All completed batch summaries
  finalReport?: string;
  error?: string;
  estimatedTimeRemaining?: number;  // seconds
  averageTimePerGroup?: number;  // seconds
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// Serial processing for local model (one at a time to avoid GPU memory issues)
const PARALLEL_BATCH_SIZE = 1;

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
  // 50 groups with pipe-delimited format
  // With ~85k results: 85k/50 = ~1,700 results per group
  // At ~95 chars/result (pipe-delimited): 1,700 * 95 = 161,500 chars = ~40,375 tokens
  // Plus prompt (~3k tokens) = ~43,375 tokens input per call
  // Plus max_tokens (10k) = ~53,375 tokens total per call (under 131k limit)
  const NUM_GROUPS = 50;

  try {
    onProgress({
      phase: 'map',
      message: 'Filtering to high-confidence results...',
      progress: 2,
      totalGroups: NUM_GROUPS,
      groupSummaries: [],
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
      groupSummaries: [],
    });

    // Partition high-confidence results
    const groups = partitionResultsForAnalysis(highConfResults, NUM_GROUPS);
    console.log(`[Overview Report] Partitioned ${highConfResults.length} results into ${groups.length} groups`);

    // Compute statistics for reduce phase (use high-conf results)
    const stats = computeOverviewStatistics(highConfResults);

    // Build user context
    const userContext = buildUserContextString(customization);

    // MAP PHASE: Analyze each group in parallel batches
    const groupSummaries: string[] = new Array(groups.length);  // Pre-allocate to maintain order
    const completedSummaries: GroupSummary[] = [];  // Track completed summaries for real-time display
    const groupTimings: number[] = [];  // Track timing for ETA calculation
    const startTime = Date.now();

    // Process groups in parallel batches of PARALLEL_BATCH_SIZE
    for (let batchStart = 0; batchStart < groups.length; batchStart += PARALLEL_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, groups.length);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

      // Calculate ETA based on completed groups
      let estimatedTimeRemaining: number | undefined;
      let averageTimePerGroup: number | undefined;
      if (groupTimings.length > 0) {
        averageTimePerGroup = groupTimings.reduce((a, b) => a + b, 0) / groupTimings.length / 1000; // seconds
        const remainingGroups = groups.length - batchStart;
        estimatedTimeRemaining = Math.ceil(averageTimePerGroup * remainingGroups);
      }

      onProgress({
        phase: 'map',
        message: `Analyzing batch ${batchStart + 1} of ${NUM_GROUPS}...`,
        progress: 5 + Math.floor((batchStart / groups.length) * 75),
        currentGroup: batchStart + 1,
        totalGroups: NUM_GROUPS,
        estimatedTimeRemaining,
        averageTimePerGroup,
        groupSummaries: completedSummaries,
      });

      // Process this batch in parallel with real-time progress updates
      const batchPromises = batchIndices.map(async (i) => {
        const group = groups[i];
        const groupNumber = i + 1;
        const groupStartTime = Date.now();

        // Format in pipe-delimited format
        const pipeDelimitedResults = formatResultsPipeDelimited(group);

        console.log(`[Overview Report] Group ${groupNumber}: Pipe-delimited sample (first 300 chars): ${pipeDelimitedResults.substring(0, 300)}`);
        console.log(`[Overview Report] Group ${groupNumber}: Data length: ${pipeDelimitedResults.length} chars for ${group.length} results = ${(pipeDelimitedResults.length / group.length).toFixed(1)} chars/result`);

        // Generate map prompt
        const mapPrompt = generateMapPrompt(
          groupNumber,
          NUM_GROUPS,
          group.length,
          highConfResults.length,
          pipeDelimitedResults,
          userContext
        );

        console.log(`[Overview Report] Map phase ${groupNumber}/${NUM_GROUPS}: Calling local model...`);
        console.log(`[Overview Report] Prompt length: ${mapPrompt.length} chars, ~${Math.ceil(mapPrompt.length / 4)} tokens`);

        // Call local Ollama via server endpoint
        // Request 5,000-word intermediate report
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200000); // 20 minute timeout

        const response = await fetch('/api/openai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: mapPrompt }],
            max_tokens: 10000,  // 5,000 words (~7k tokens) + reasoning (~3k)
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(`Local model API error: ${errorData.error || response.statusText}`);
        }

        const data = await response.json();
        const summary = data.content;

        if (!summary) {
          throw new Error(`Map phase ${groupNumber} produced no summary`);
        }

        // Track timing for this group
        const groupEndTime = Date.now();
        const groupDuration = groupEndTime - groupStartTime;

        console.log(`[Overview Report] Map phase ${groupNumber}/${NUM_GROUPS}: Success (${summary.length} chars, ${(groupDuration / 1000).toFixed(1)}s)`);

        // Store result immediately
        groupSummaries[i] = summary;
        groupTimings.push(groupDuration);

        // Add to completed summaries for real-time display
        completedSummaries.push({
          groupNumber: groupNumber,
          summary: summary,
        });

        // Update progress immediately after this batch completes
        const completedCount = groupTimings.length;
        const avgTime = groupTimings.reduce((a, b) => a + b, 0) / groupTimings.length / 1000; // seconds
        const remainingGroups = groups.length - completedCount;
        const eta = remainingGroups > 0 ? Math.ceil(avgTime * remainingGroups) : 0;

        onProgress({
          phase: 'map',
          message: `Completed batch ${groupNumber} of ${NUM_GROUPS}`,
          progress: 5 + Math.floor((completedCount / groups.length) * 75),
          currentGroup: completedCount,
          totalGroups: NUM_GROUPS,
          estimatedTimeRemaining: eta,
          averageTimePerGroup: avgTime,
          groupSummaries: [...completedSummaries],  // Send copy of all completed summaries
        });

        return { index: i, summary, duration: groupDuration };
      });

      // Wait for all in this batch to complete
      await Promise.all(batchPromises);
    }

    // REDUCE PHASE: Synthesize all summaries
    onProgress({
      phase: 'reduce',
      message: 'Synthesizing comprehensive report...',
      progress: 85,
      groupSummaries: completedSummaries,
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

    // Call local Ollama for final synthesis
    // Request 5,000-word comprehensive final report
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200000); // 20 minute timeout

    const response = await fetch('/api/openai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: reducePrompt }],
        max_tokens: 10000,  // 5,000 words (~7k tokens) + reasoning (~3k)
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Local model API error: ${errorData.error || response.statusText}`);
    }

    const data = await response.json();
    const finalReport = data.content;

    if (!finalReport) {
      throw new Error('Reduce phase produced no final report');
    }

    console.log(`[Overview Report] Reduce phase: Success (${finalReport.length} chars)`);

    // Append intermediate batch reports to final report for full context
    const appendix = groupSummaries
      .map((summary, i) => `\n\n---\n\n## BATCH ${i + 1} DETAILED ANALYSIS\n\n${summary}`)
      .join('\n');

    const completeReport = `${finalReport}\n\n---\n\n# APPENDIX: DETAILED BATCH ANALYSES\n\nThe following sections contain the detailed intermediate analyses for each of the ${NUM_GROUPS} batches. These provide granular insights into specific subsets of your genetic data.\n${appendix}`;

    onProgress({
      phase: 'complete',
      message: 'Report generated successfully!',
      progress: 100,
      finalReport: completeReport,
      groupSummaries: completedSummaries,
    });

    return completeReport;
  } catch (error) {
    console.error('[Overview Report] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    onProgress({
      phase: 'error',
      message: 'Generation failed',
      progress: 0,
      error: errorMessage,
      groupSummaries: [],
    });

    throw error;
  }
}
