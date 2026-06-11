/**
 * Health Insights Report Service - CLIENT-SIDE ONLY
 *
 * Generates a personalized report anchored to the user's health history.
 * Selects targeted results by condition keyword match and overall effect
 * magnitude, then makes a single LLM call to identify genetic mechanisms
 * and surface insights the user doesn't already know.
 */

import type { SavedResult } from './results-manager';
import { buildUserContextString } from './overview-report-analyzer';
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

// ── Keyword helpers ──

const STOP_WORDS = new Set([
  'and', 'or', 'the', 'of', 'with', 'in', 'to', 'a', 'an', 'for', 'by', 'at', 'on',
  'is', 'it', 'its', 'as', 'my', 'our', 'their', 'has', 'have', 'had',
  'past', 'history', 'former', 'previous', 'current', 'recent',
  'disease', 'disorder', 'syndrome', 'condition', 'related', 'associated',
  'chronic', 'acute', 'primary', 'secondary', 'other', 'type', 'stage',
  'generalized', 'loss', 'level', 'levels', 'soft', 'mild', 'moderate', 'severe',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreMatch(keywords: string[], traitName: string): number {
  const trait = traitName.toLowerCase();
  return keywords.reduce((sum, kw) => sum + (trait.includes(kw) ? 1 : 0), 0);
}

// Require at least half the keywords to match — avoids single-word false positives
function minScore(keywords: string[]): number {
  return Math.max(1, Math.ceil(keywords.length / 2));
}

function effectMagnitude(r: SavedResult): number {
  if (!r.riskScore || r.riskScore <= 0) return 0;
  if (r.effectType === 'beta') return Math.abs(r.riskScore);
  return Math.abs(Math.log(r.riskScore));
}

function isValidOR(r: SavedResult): boolean {
  return r.effectType === 'OR' && r.riskScore > 0.05 && r.riskScore < 50;
}

// For broad sweeps (steps 2 & 3), exclude extreme ORs — they're almost always
// specialized-cohort artifacts and inflate the "most notable" section misleadingly.
function isCredibleOR(r: SavedResult): boolean {
  return isValidOR(r) && r.riskScore < 10 && r.riskScore > 0.1;
}

// ── Result selection ──

export type SelectedResult = SavedResult & { matchedCondition?: string };

function selectResults(results: SavedResult[], customization: any): SelectedResult[] {
  const conditions: { label: string; type: 'personal' | 'family' }[] = [
    ...(customization?.personalConditions ?? []).map((c: string) => ({ label: c, type: 'personal' as const })),
    ...(customization?.familyConditions ?? []).map((c: string) => ({ label: c, type: 'family' as const })),
  ];

  const selected = new Map<number, SelectedResult>();

  // 1. Condition-matched results (up to 12 per condition, half-keyword minimum)
  for (const { label, type } of conditions) {
    const keywords = extractKeywords(label);
    if (keywords.length === 0) continue;
    const threshold = minScore(keywords);
    const tag = `${type === 'family' ? 'family history: ' : ''}${label}`;

    results
      .filter(isValidOR)
      .map(r => ({ r, score: scoreMatch(keywords, r.traitName) }))
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return effectMagnitude(b.r) - effectMagnitude(a.r);
      })
      .slice(0, 12)
      .forEach(({ r }) => {
        if (!selected.has(r.studyId)) selected.set(r.studyId, { ...r, matchedCondition: tag });
      });
  }

  // 2. Strongest elevated signals not yet included (up to 30)
  //    Use isCredibleOR to exclude extreme-OR artifacts from broad sweeps.
  const MAX_OVERALL = 30;
  results
    .filter(r => isCredibleOR(r) && r.riskLevel === 'increased' && !selected.has(r.studyId))
    .sort((a, b) => effectMagnitude(b) - effectMagnitude(a))
    .slice(0, MAX_OVERALL - Math.min(selected.size, MAX_OVERALL))
    .forEach(r => selected.set(r.studyId, r));

  // 3. Strongest protective signals not yet included (up to 20)
  results
    .filter(r => isCredibleOR(r) && r.riskLevel === 'decreased' && !selected.has(r.studyId))
    .sort((a, b) => effectMagnitude(b) - effectMagnitude(a))
    .slice(0, 20)
    .forEach(r => selected.set(r.studyId, r));

  return Array.from(selected.values());
}

// ── Formatting ──

function pValueTier(r: SavedResult): string {
  const mlog = parseFloat(r.pValueMlog ?? '');
  if (isNaN(mlog)) return '';
  if (mlog >= 10) return ' | p: very strong';
  if (mlog >= 7.3) return ' | p: strong';
  if (mlog >= 5) return ' | p: moderate';
  return ' | p: suggestive';
}

function orCaveat(score: number): string {
  if (score >= 10) return ' ⚠ unusually large OR — likely rare subtype or specialized cohort';
  if (score >= 5) return ' ⚠ large OR — interpret with caution';
  return '';
}

function formatResult(r: SelectedResult): string {
  const dir = r.riskLevel === 'increased' ? '↑' : r.riskLevel === 'decreased' ? '↓' : '→';
  const effect = r.effectType === 'OR'
    ? `OR ${r.riskScore.toFixed(2)}x ${dir}${orCaveat(r.riskScore)}`
    : `β=${r.riskScore >= 0 ? '+' : ''}${r.riskScore.toFixed(3)} ${dir}`;
  const gene = r.mappedGene ? ` | gene: ${r.mappedGene}` : '';
  const snp = r.matchedSnp ? ` | snp: ${r.matchedSnp}` : '';
  const genotype = r.userGenotype ? ` | genotype: ${r.userGenotype}${r.riskAllele ? ` (risk allele: ${r.riskAllele})` : ''}` : '';
  const pv = pValueTier(r);
  const match = r.matchedCondition ? ` [matched: ${r.matchedCondition}]` : '';
  return `${r.traitName} | ${effect}${gene}${snp}${genotype}${pv}${match}`;
}

function buildPrompt(selected: SelectedResult[], customization: any): string {
  const userCtx = buildUserContextString(customization);
  const conditions = [
    ...(customization?.personalConditions ?? []),
    ...(customization?.familyConditions ?? []).map((c: string) => `${c} (family history)`),
  ];
  const hasHealthHistory = conditions.length > 0;

  const conditionSection = hasHealthHistory
    ? `\nHEALTH HISTORY:\n${conditions.join('\n')}\n`
    : '';

  const conditionMatched = selected.filter(r => r.matchedCondition);
  const elevated = selected.filter(r => !r.matchedCondition && r.riskLevel === 'increased');
  const protective = selected.filter(r => !r.matchedCondition && r.riskLevel === 'decreased');

  const sections = [
    conditionMatched.length > 0
      ? `RESULTS MATCHED TO HEALTH HISTORY (${conditionMatched.length}):\n${conditionMatched.map(formatResult).join('\n')}`
      : null,
    elevated.length > 0
      ? `STRONGEST ADDITIONAL ELEVATED SIGNALS (${elevated.length}):\n${elevated.map(formatResult).join('\n')}`
      : null,
    protective.length > 0
      ? `STRONGEST PROTECTIVE SIGNALS (${protective.length}):\n${protective.map(formatResult).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n');

  const instruction = hasHealthHistory ? `
The user already knows they have these conditions — do NOT simply report "you have variants for X and you reported X." That adds no value.

Instead, write a report that tells them something genuinely new. Structure it as follows:

**1. Genetic mechanisms underlying your conditions**
Explain WHY the user has certain conditions at a biological pathway level. What mechanism do the variants operate through? How do multiple variants converge on the same pathway? Be specific — not "increases inflammation" but which cells, which signaling molecules, which process.

**2. What your genome protects you from**
Use the protective signals section. Identify any large protective effects — especially any that counterbalance elevated risks in the same pathway, or protect against conditions that run in the family. These are often the most surprising and useful findings.

**3. Signals outside your known health history**
From the strongest overall signals, identify anything that points to conditions or traits NOT mentioned in the user's health history. These are genuinely novel — flag them clearly as "you may not have known this."

**4. Most notable findings** (4-5 bullets)
The most surprising, largest-effect, or cross-cutting discoveries. Prioritize findings that the user could not have known just from their symptoms.

**5. What to investigate further**
3-4 specific research threads the user could pursue to understand their genetic dynamics better. Frame these as topics to read about or questions to explore, not clinical actions. Focus on: specific genes that appeared repeatedly and have well-studied literature, pathway connections worth understanding, or cross-trait mechanisms that link seemingly unrelated findings.

Language rules (strictly enforced):
- These are population-level GWAS associations, not individual predictions. Write accordingly: "population studies associate this variant with X", "carriers of this allele show", "this signal is consistent with" — never "your genome does X" or "this drives your Y".
- For mechanisms: describe what the gene/pathway does in the population literature, not what it is doing in this person's body. "BTBD9 is associated with dopamine regulation in RLS cohorts" not "your BTBD9 variants are disrupting your dopamine signaling."
- For protective signals: "population studies find this allele associated with lower rates of X" not "your genome protects you from X."
- Include rsIDs when mentioning specific variants (e.g., "rs429358, an APOE variant"). Where the user's genotype is informative (heterozygous vs homozygous), note it: "carrying one copy of the risk allele" vs "homozygous for the risk allele."
- Flag any OR > 5x as "large effect — likely a specialized or rare-variant study; treat as uncertain." Do not anchor conclusions on it.
- Do not recommend clinical tests, doctors, or lifestyle changes.
- Distinguish between well-replicated signals (strong p-value label, named gene) and single suggestive hits.
- 700-900 words total`
  : `
Write a report organized by GENETIC MECHANISM (4-5 mechanisms). For each:
- Name specific variants and explain effect sizes in plain, concrete terms
- Identify what biological process is involved at a molecular level
- Flag any OR > 5x as a large effect likely from a specialized study

Then add:
**Protective signals**: Associations where the allele is linked to lower rates in population studies. Use hedged language.
**Most notable findings**: 4-5 bullets of the most striking discoveries.
**What to investigate further**: 3-4 research threads the user could explore. Specific genes, pathways, or cross-trait connections with well-studied literature.

Language rules (strictly enforced):
- These are population-level statistics. Write "population studies associate this variant with X", never "your genome does X" or deterministic personal claims.
- Do not recommend clinical tests, doctors, or lifestyle changes.

700-900 words.`;

  return `You are a genetic counselor writing a personalized health insights report. Your goal is to surface insights the user does not already know from their symptoms alone.
${userCtx}
${conditionSection}
${sections}

DATA FORMAT: Trait | Effect size (↑ elevated / ↓ protective) | Gene | SNP (rsID) | Genotype (risk allele) | Statistical confidence | [matched condition]
${instruction}

After the report, append exactly this block (required, verbatim format):

CHAT_QUESTIONS:
- [a specific follow-up question about a gene, SNP, or mechanism from this report]
- [a question about a cross-trait pattern or surprising finding]
- [a question about a protective signal or novel finding outside the health history]
- [a question about what the user's specific genotype means for one of the key findings]
- [a question about a research thread worth exploring]

Questions must reference specific genes, rsIDs, or findings from this report. Write them as the user would ask them.`;
}

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
        content: 'You are a genetic epidemiologist writing an educational report about population-level GWAS associations. These data are statistical patterns from large cohorts — they are not individual predictions or diagnoses. Maintain appropriate epistemic humility throughout: write "population studies associate this variant with X" or "carriers of this allele show Y in cohort data", never "your genome does X" or "this is driving your condition." Do not convert population odds ratios into statements about what is happening in this individual\'s body. Do not use LaTeX or math notation. Do not recommend clinical tests, doctors, or healthcare appointments. Do not repeat what the user told you about their own health history as if it is a novel finding.',
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 10000, temperature: 0.35, reasoningEffort: 'high' }
  );

  if (!response.content) throw new Error('No report generated.');

  const [reportText, questionsBlock] = response.content.split(/\n+CHAT_QUESTIONS:\n/);
  const questions = questionsBlock
    ? questionsBlock.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(Boolean)
    : [];

  onProgress({ phase: 'complete', message: 'Done', progress: 100, finalReport: reportText.trim() });
  return { report: reportText.trim(), selected, questions };
}
