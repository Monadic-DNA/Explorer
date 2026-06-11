/**
 * Top Traits Report Service - CLIENT-SIDE ONLY
 *
 * Selects the 50 highest-signal genetic associations by effect magnitude
 * and synthesizes a report around the strongest patterns.
 */

import type { SavedResult } from './results-manager';
import { buildUserContextString } from './overview-report-analyzer';
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

const TOP_N = 100;

function effectMagnitude(r: SavedResult): number {
  if (!r.riskScore) return 0;
  if (r.effectType === 'beta') return Math.abs(r.riskScore);
  if (r.riskScore <= 0) return 0;
  return Math.abs(Math.log(r.riskScore));
}

function isCredible(r: SavedResult): boolean {
  if (r.effectType === 'beta') return Math.abs(r.riskScore) < 50;
  return r.effectType === 'OR' && r.riskScore > 0.1 && r.riskScore < 10;
}

function pValueTier(r: SavedResult): string {
  const mlog = parseFloat(r.pValueMlog ?? '');
  if (isNaN(mlog)) return '';
  if (mlog >= 10) return ' | p: very strong';
  if (mlog >= 7.3) return ' | p: strong';
  if (mlog >= 5) return ' | p: moderate';
  return ' | p: suggestive';
}

function formatResult(r: SavedResult): string {
  const dir = r.riskLevel === 'increased' ? '↑' : r.riskLevel === 'decreased' ? '↓' : '→';
  const effect = r.effectType === 'OR'
    ? `OR ${r.riskScore.toFixed(2)}x ${dir}`
    : `β=${r.riskScore >= 0 ? '+' : ''}${r.riskScore.toFixed(3)} ${dir}`;
  const gene = r.mappedGene ? ` | gene: ${r.mappedGene}` : '';
  const snp = r.matchedSnp ? ` | snp: ${r.matchedSnp}` : '';
  const genotype = r.userGenotype ? ` | genotype: ${r.userGenotype}${r.riskAllele ? ` (risk allele: ${r.riskAllele})` : ''}` : '';
  return `${r.traitName} | ${effect}${gene}${snp}${genotype}${pValueTier(r)}`;
}

function selectTopTraits(results: SavedResult[]): SavedResult[] {
  const credible = results.filter(isCredible);
  const byType = (type: 'OR' | 'beta', n: number) =>
    credible
      .filter(r => r.effectType === type)
      .sort((a, b) => effectMagnitude(b) - effectMagnitude(a))
      .slice(0, n);

  // Take up to 25 from each type so large raw beta values don't bury OR results.
  // If one type is scarce, fill remaining slots from the other.
  const orResults = byType('OR', 25);
  const betaResults = byType('beta', 25);
  const remaining = TOP_N - orResults.length - betaResults.length;
  if (remaining > 0) {
    const orExtra = byType('OR', 25 + remaining).slice(orResults.length);
    const betaExtra = byType('beta', 25 + remaining).slice(betaResults.length);
    return [...orResults, ...betaResults, ...orExtra, ...betaExtra].slice(0, TOP_N);
  }
  return [...orResults, ...betaResults];
}

function buildPrompt(selected: SavedResult[], customization: any): string {
  const userCtx = buildUserContextString(customization);
  const elevated = selected.filter(r => r.riskLevel === 'increased');
  const protective = selected.filter(r => r.riskLevel === 'decreased');

  const sections = [
    elevated.length > 0
      ? `ELEVATED SIGNALS (${elevated.length}):\n${elevated.map(formatResult).join('\n')}`
      : null,
    protective.length > 0
      ? `PROTECTIVE SIGNALS (${protective.length}):\n${protective.map(formatResult).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n');

  return `You are writing a personalized genetics report. These are the 50 strongest genetic signals by effect size across all results.
${userCtx}

DATA FORMAT: Trait | Effect size (↑ elevated / ↓ protective) | Gene | SNP (rsID) | Genotype (risk allele) | Statistical confidence

${sections}

Your job is to build a hypothesis about this person's biological character from their strongest signals. Not a gene-by-gene tour; a portrait. What kind of metabolism, immune system, and brain does population-level data suggest this profile is associated with? What is the most interesting or unexpected thing about this combination of signals?

Structure:
**Biological portrait** (3-4 sentences)
Open with a direct hypothesis: what does this combination of strong signals most plausibly suggest about how this person's body works? Be specific and opinionated, and frame it as a hypothesis drawn from population statistics, not a fact. Mention the 1-2 most important signals by name.

**Key themes** (3-4 themes, each as a short header + 2 paragraphs)
Choose the 3-4 most important biological stories in these results. Each theme should:
- Start with a one-sentence hypothesis about what the signals in this theme collectively suggest about this person's biology
- Second paragraph: what do the specific genes/SNPs do, and why do they cluster; what does this combination mean together
- Include specific rsIDs and genotypes where informative
- Mention both elevated and protective signals within the theme where they interact
- Skip pseudogenes (LINC, LOC, MIR)

**What stands out** (1 paragraph)
The most surprising, counterintuitive, or medically interesting finding in these results: something the person is unlikely to have noticed on their own. Explain why it matters.

**Hypotheses about you** (4 hypotheses, each 2-3 sentences)
Based on the patterns in these signals, write 4 specific, testable hypotheses about this person's biology or lived experience. Each should be a concrete statement about something that may be true about them — how they feel, how their body tends to work, what they may notice about themselves — grounded in the strongest signals. Frame each as "People with this signal pattern tend to..." or "This combination of variants is consistent with someone who...". Be direct and specific. These should feel like insights, not disclaimers.

Style rules:
- Write for someone who wants to understand their own biology, not a textbook
- Population-level language throughout: "population studies associate", "carriers tend to show", never "your genome does X"
- Be specific: name the genes, cite rsIDs, note genotypes where the user's specific variant is informative
- Do not recommend clinical tests, doctors, or lifestyle changes
- 700-900 words total

After the report, append exactly this block (required, verbatim format):

CHAT_QUESTIONS:
- [a question about the most prominent gene or pathway from this report]
- [a question about how two of the top signals relate to each other]
- [a question about one of the protective signals or a surprising finding]
- [a question about what a specific genotype means for one of the key themes]

Questions must reference specific genes, rsIDs, or findings from this report. Write them as the user would ask them.`;
}

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
        content: 'You are a science writer with deep genetics knowledge. Write engagingly for a reader who understands GWAS but wants insight, not inventory. Use population-level language ("population studies associate", "carriers show") but keep it fluid. Never add a disclaimer paragraph at the top. Do not recommend clinical tests, doctors, or healthcare appointments.',
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 8000, temperature: 0.3, reasoningEffort: 'medium' }
  );

  if (!response.content) throw new Error('No report generated.');

  const [reportText, questionsBlock] = response.content.split(/\n+CHAT_QUESTIONS:\n/);
  const questions = questionsBlock
    ? questionsBlock.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(Boolean)
    : [];

  onProgress({ phase: 'complete', message: 'Done', progress: 100 });
  return { report: reportText.trim(), selected, questions };
}
