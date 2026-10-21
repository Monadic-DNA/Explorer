/**
 * Health Insights Report Service - CLIENT-SIDE ONLY
 *
 * Generates a personalized report anchored to the user's health history.
 * Selects targeted results by condition keyword match and overall effect
 * magnitude, then makes a single LLM call to identify genetic mechanisms
 * and surface insights the user doesn't already know.
 */

import type { SavedResult } from './results-manager';
import { coreCall } from "./core";
import { callLLM } from './llm-client';

export type HealthReportProgress = {
  phase: 'selecting' | 'generating' | 'complete' | 'error';
  message: string;
  progress: number;
  finalReport?: string;
  error?: string;
};

export type HealthReportCallback = (update: HealthReportProgress) => void;

export type HealthReportResult = {
  report: string;
  selected: SelectedResult[];
  questions: string[];
};

export type SelectedResult = SavedResult & { matchedCondition?: string };
function selectResults(results: SavedResult[], customization: unknown): SelectedResult[] { return coreCall<{ selected: SelectedResult[] }>("select_report", { kind: "health", results, customization }).selected; }
function buildPrompt(selected: SelectedResult[], customization: unknown): string { return coreCall<{ messages: { content: string }[] }>("report_prompt", { kind: "health", selected, customization }).messages[1].content; }

// ── Main export ──

export async function generateHealthReport(
  results: SavedResult[],
  customization: any,
  onProgress: HealthReportCallback
): Promise<HealthReportResult> {
  onProgress({ phase: 'selecting', message: 'Selecting relevant results…', progress: 10 });

  const selected = selectResults(results, customization);
  if (selected.length === 0) {
    throw new Error('No results available to analyze. Run analysis first.');
  }

  const conditionCount = selected.filter(r => r.matchedCondition).length;
  const protectiveCount = selected.filter(r => r.riskLevel === 'decreased').length;

  onProgress({
    phase: 'generating',
    message: `Analyzing ${selected.length} associations (${conditionCount} matched to your health history, ${protectiveCount} protective signals)…`,
    progress: 30,
  });

  const prompt = buildPrompt(selected, customization);

  const response = await callLLM(
    [
      {
        role: 'system',
        content: coreCall<{ messages: { content: string }[] }>("report_prompt", { kind: "health", selected, customization }).messages[0].content,
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 10000, temperature: 0.35, reasoningEffort: 'high' }
  );

  if (!response.content) throw new Error('No report generated.');

  const parsed = coreCall<{ report: string; questions: string[] }>("extract_report", response.content);
  const reportText = parsed.report;
  const questions = parsed.questions;

  onProgress({ phase: 'complete', message: 'Done', progress: 100, finalReport: reportText.trim() });
  return { report: reportText.trim(), selected, questions };
}
