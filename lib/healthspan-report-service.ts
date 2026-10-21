/**
 * Healthspan Report Service - CLIENT-SIDE ONLY
 *
 * Organizes the user's saved results by healthspan domain (cardiovascular,
 * metabolic, neurological, etc.), selects the highest-signal traits per domain,
 * and synthesizes a domain-by-domain report.
 */

import type { SavedResult } from './results-manager';
import { coreCall } from "./core";
import { callLLM } from './llm-client';

export type HealthspanReportProgress = {
  phase: 'selecting' | 'generating' | 'complete' | 'error';
  message: string;
  progress: number;
};

export type HealthspanReportCallback = (update: HealthspanReportProgress) => void;

export type DomainResult = SavedResult & { domain: string };

export type HealthspanReportResult = {
  report: string;
  selected: DomainResult[];
  domainCounts: Record<string, { elevated: number; protective: number }>;
  questions: string[];
};

type Domain = { id: string; label: string; keywords: string[] };
const DOMAINS = coreCall<{ domains: Domain[] }>("report_rules").domains;
export const DOMAIN_LABELS: Record<string, string> = Object.fromEntries(DOMAINS.map(d => [d.id, d.label]));
function selectByDomain(results: SavedResult[]): { selected: DomainResult[]; counts: Record<string, { elevated: number; protective: number }> } { return coreCall("select_report", { kind: "healthspan", results }); }
function buildPrompt(selected: DomainResult[], _counts: unknown, customization: unknown): string { return coreCall<{ messages: { content: string }[] }>("report_prompt", { kind: "healthspan", selected, customization }).messages[1].content; }

// ── Main export ──

export async function generateHealthspanReport(
  results: SavedResult[],
  customization: any,
  onProgress: HealthspanReportCallback
): Promise<HealthspanReportResult> {
  onProgress({ phase: 'selecting', message: 'Organizing results by healthspan domain…', progress: 10 });

  const { selected, counts } = selectByDomain(results);
  const activeDomains = DOMAINS.filter(d => (counts[d.id]?.elevated ?? 0) + (counts[d.id]?.protective ?? 0) >= 2);

  if (activeDomains.length === 0) {
    throw new Error('Not enough results matched any healthspan domain. Run a broader analysis first.');
  }

  onProgress({
    phase: 'generating',
    message: `Synthesizing ${selected.length} associations across ${activeDomains.length} domains…`,
    progress: 30,
  });

  const prompt = buildPrompt(selected, counts, customization);

  const response = await callLLM(
    [
      {
        role: 'system',
        content: coreCall<{ messages: { content: string }[] }>("report_prompt", { kind: "healthspan", selected, customization }).messages[0].content,
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 10000, temperature: 0.3, reasoningEffort: 'medium' }
  );

  if (!response.content) throw new Error('No report generated.');

  const parsed = coreCall<{ report: string; questions: string[] }>("extract_report", response.content);
  const reportText = parsed.report;
  const questions = parsed.questions;

  onProgress({ phase: 'complete', message: 'Done', progress: 100 });
  return { report: reportText.trim(), selected, domainCounts: counts, questions };
}
