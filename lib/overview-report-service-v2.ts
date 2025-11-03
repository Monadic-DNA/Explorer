/**
 * Overview Report Service V2 - SIMPLIFIED APPROACH
 *
 * Instead of trying to analyze ALL 92k results (which hits token limits),
 * we analyze the TOP MOST SIGNIFICANT results only.
 *
 * Strategy:
 * 1. Select top 5,000 most significant results (by effect size)
 * 2. Split into 3 groups of ~1,666 each
 * 3. Use VERY compact format: "trait|level|score"
 * 4. Add delays between calls to avoid rate limits
 * Total: 4 LLM calls (3 map + 1 reduce), ~5 minutes
 */

import { NilaiOpenAIClient, AuthType, NilAuthInstance } from '@nillion/nilai-ts';
import type { SavedResult } from './results-manager';

const DELAY_BETWEEN_CALLS_MS = 5000; // 5 seconds between calls to avoid rate limits

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Select top N most significant results
 */
function selectTopResults(results: SavedResult[], limit: number): SavedResult[] {
  return [...results]
    .sort((a, b) => {
      const aDistance = Math.abs(a.riskScore - 1.0);
      const bDistance = Math.abs(b.riskScore - 1.0);
      return bDistance - aDistance;
    })
    .slice(0, limit);
}

/**
 * Ultra-compact format - just the essentials
 */
function formatCompact(results: SavedResult[]): string {
  return results
    .map(r => {
      const trait = r.traitName.substring(0, 40);
      const level = r.riskLevel[0]; // 'i', 'd', or 'n'
      return `${trait}|${level}|${r.riskScore.toFixed(1)}`;
    })
    .join('\n');
}

export interface ProgressUpdate {
  phase: 'map' | 'reduce' | 'complete' | 'error';
  message: string;
  progress: number;
  currentGroup?: number;
  totalGroups?: number;
  finalReport?: string;
  error?: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Generate overview report - SIMPLIFIED VERSION
 */
export async function generateOverviewReport(
  allResults: SavedResult[],
  customization: any,
  onProgress: ProgressCallback
): Promise<string> {
  try {
    onProgress({
      phase: 'map',
      message: 'Selecting top significant results...',
      progress: 5,
    });

    // STEP 1: Select top 5000 most significant results
    const TOP_N = 5000;
    const topResults = selectTopResults(allResults, TOP_N);

    console.log(`[Overview] Selected top ${topResults.length} of ${allResults.length} results`);

    // STEP 2: Split into 3 manageable groups
    const NUM_GROUPS = 3;
    const groupSize = Math.ceil(topResults.length / NUM_GROUPS);
    const groups = [];

    for (let i = 0; i < NUM_GROUPS; i++) {
      const start = i * groupSize;
      const end = Math.min(start + groupSize, topResults.length);
      groups.push(topResults.slice(start, end));
    }

    // Build user context
    const userParts = [];
    if (customization?.age) userParts.push(`Age ${customization.age}`);
    if (customization?.genderAtBirth) userParts.push(customization.genderAtBirth);
    if (customization?.ethnicities?.length) userParts.push(customization.ethnicities.join(', '));
    const userContext = userParts.length ? `\nUser: ${userParts.join(', ')}` : '';

    // MAP PHASE
    const groupSummaries: string[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const groupNum = i + 1;
      const progress = 10 + Math.floor((i / NUM_GROUPS) * 70);

      onProgress({
        phase: 'map',
        message: `Analyzing group ${groupNum} of ${NUM_GROUPS} (${group.length} results)...`,
        progress,
        currentGroup: groupNum,
        totalGroups: NUM_GROUPS,
      });

      const compact = formatCompact(group);

      const prompt = `Analyze these ${group.length} genetic results (group ${groupNum}/${NUM_GROUPS}).${userContext}

Format: Trait|Risk|Score (i=increased, d=decreased, n=neutral)
${compact}

Identify 3-5 major themes and patterns. Be concise (400 words). Focus on significant findings.`;

      console.log(`[Overview] Group ${groupNum}: ${prompt.length} chars, ~${Math.ceil(prompt.length / 4)} tokens`);

      // Get delegation token
      const client = new NilaiOpenAIClient({
        baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
        authType: AuthType.DELEGATION_TOKEN,
        nilauthInstance: NilAuthInstance.PRODUCTION,
      });

      const delegationRequest = client.getDelegationRequest();
      const tokenRes = await fetch('/api/nilai-delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegationRequest }),
      });

      if (!tokenRes.ok) throw new Error('Failed to get delegation token');

      const { delegationToken } = await tokenRes.json();
      client.updateDelegation(delegationToken);

      // Call nilAI
      const response = await client.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.7,
      });

      const summary = response.choices?.[0]?.message?.content;
      if (!summary) throw new Error(`Group ${groupNum} produced no summary`);

      groupSummaries.push(summary);
      console.log(`[Overview] Group ${groupNum}: Success`);

      // Delay before next call to avoid rate limits
      if (i < groups.length - 1) {
        onProgress({
          phase: 'map',
          message: `Waiting ${DELAY_BETWEEN_CALLS_MS / 1000}s before next analysis...`,
          progress: progress + 5,
        });
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }

    // REDUCE PHASE
    onProgress({
      phase: 'reduce',
      message: 'Synthesizing comprehensive report...',
      progress: 85,
    });

    await sleep(DELAY_BETWEEN_CALLS_MS); // Delay before reduce call

    const reducePrompt = `Create a comprehensive genetic overview report from these ${NUM_GROUPS} group analyses.${userContext}

GROUP SUMMARIES:
${groupSummaries.map((s, i) => `\n=== GROUP ${i + 1} ===\n${s}`).join('\n')}

STATISTICS:
- Total analyzed: ${allResults.length.toLocaleString()} results
- Top ${TOP_N} most significant analyzed in detail
- Increased risk: ${allResults.filter(r => r.riskLevel === 'increased').length}
- Decreased risk: ${allResults.filter(r => r.riskLevel === 'decreased').length}

Create a 1500-word personalized report with:
1. Executive Summary (3-4 sentences)
2. Major Health Categories (6-8 sections covering cardiovascular, metabolic, etc.)
3. Key Strengths (protective factors)
4. Areas to Monitor
5. Personalized Action Plan (lifestyle, diet, exercise recommendations)
6. Disclaimers (GWAS limitations, educational purposes only)

Use markdown formatting. Be encouraging and actionable.`;

    console.log(`[Overview] Reduce: ${reducePrompt.length} chars, ~${Math.ceil(reducePrompt.length / 4)} tokens`);

    // Get fresh delegation token
    const client = new NilaiOpenAIClient({
      baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
      authType: AuthType.DELEGATION_TOKEN,
      nilauthInstance: NilAuthInstance.PRODUCTION,
    });

    const delegationRequest = client.getDelegationRequest();
    const tokenRes = await fetch('/api/nilai-delegation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delegationRequest }),
    });

    if (!tokenRes.ok) throw new Error('Failed to get delegation token');

    const { delegationToken } = await tokenRes.json();
    client.updateDelegation(delegationToken);

    const response = await client.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: reducePrompt }],
      max_tokens: 3000,
      temperature: 0.7,
    });

    const finalReport = response.choices?.[0]?.message?.content;
    if (!finalReport) throw new Error('Reduce phase produced no report');

    console.log(`[Overview] Success! Report length: ${finalReport.length} chars`);

    onProgress({
      phase: 'complete',
      message: 'Report generated!',
      progress: 100,
      finalReport,
    });

    return finalReport;
  } catch (error) {
    console.error('[Overview] Error:', error);

    onProgress({
      phase: 'error',
      message: 'Generation failed',
      progress: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}
