/**
 * Top Traits Report Service - CLIENT-SIDE ONLY
 *
 * Selects the 50 highest-signal genetic associations by effect magnitude
 * and synthesizes a report around the strongest patterns.
 */

import type { SavedResult } from './results-manager';
import { coreCall } from "./core";
import { callLLM } from './llm-client';

export type TopTraitsReportProgress = {
  phase: 'selecting' | 'generating' | 'complete' | 'error';
  message: string;
  progress: number;
};

export type TopTraitsReportCallback = (update: TopTraitsReportProgress) => void;

export type TopTraitsReportResult = {
  report: string;
  selected: SavedResult[];
  questions: string[];
};

function selectTopTraits(results: SavedResult[]): SavedResult[] { return coreCall<{ selected: SavedResult[] }>("select_report", { kind: "toptraits", results }).selected; }
function buildPrompt(selected: SavedResult[], customization: unknown): string { return coreCall<{ messages: { content: string }[] }>("report_prompt", { kind: "toptraits", selected, customization }).messages[1].content; }

export async function generateTopTraitsReport(
  results: SavedResult[],
  customization: any,
  onProgress: TopTraitsReportCallback
): Promise<TopTraitsReportResult> {
  onProgress({ phase: 'selecting', message: 'Selecting top 100 signals by effect size…', progress: 10 });

  const selected = selectTopTraits(results);
  if (selected.length === 0) {
    throw new Error('No credible results available. Run analysis first.');
  }

  onProgress({
    phase: 'generating',
    message: `Synthesizing ${selected.length} highest-signal associations…`,
    progress: 30,
  });

  const prompt = buildPrompt(selected, customization);

  const response = await callLLM(
    [
      {
        role: 'system',
        content: coreCall<{ messages: { content: string }[] }>("report_prompt", { kind: "toptraits", selected, customization }).messages[0].content,
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 8000, temperature: 0.3, reasoningEffort: 'medium' }
  );

  if (!response.content) throw new Error('No report generated.');

  const parsed = coreCall<{ report: string; questions: string[] }>("extract_report", response.content);
  const reportText = parsed.report;
  const questions = parsed.questions;

  onProgress({ phase: 'complete', message: 'Done', progress: 100 });
  return { report: reportText.trim(), selected, questions };
}
