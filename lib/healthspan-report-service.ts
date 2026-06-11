/**
 * Healthspan Report Service - CLIENT-SIDE ONLY
 *
 * Organizes the user's saved results by healthspan domain (cardiovascular,
 * metabolic, neurological, etc.), selects the highest-signal traits per domain,
 * and synthesizes a domain-by-domain report.
 */

import type { SavedResult } from './results-manager';
import { buildUserContextString } from './overview-report-analyzer';
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

// ── Domain definitions ──

type Domain = { id: string; label: string; keywords: string[] };

const DOMAINS: Domain[] = [
  {
    id: 'cardiovascular',
    label: 'Cardiovascular',
    keywords: ['coronary', 'cardiac', 'heart', 'atrial', 'arrhythmia', 'myocardial', 'arterial', 'vascular', 'hypertension', 'cholesterol', 'triglyceride', 'lipoprotein', 'stroke', 'fibrillation', 'thrombosis', 'aortic', 'ischemic', 'angina', 'systolic', 'diastolic'],
  },
  {
    id: 'metabolic',
    label: 'Metabolic & Endocrine',
    keywords: ['diabetes', 'insulin', 'glucose', 'obesity', 'bmi', 'metabolic', 'adipose', 'adiposity', 'glycemic', 'thyroid', 'hypothyroid', 'hyperthyroid', 'testosterone', 'estrogen', 'waist', 'leptin', 'ghrelin'],
  },
  {
    id: 'neurological',
    label: 'Neurological & Cognitive',
    keywords: ['alzheimer', 'dementia', 'parkinson', 'cognitive', 'intelligence', 'brain', 'neurological', 'epilepsy', 'depression', 'anxiety', 'psychiatric', 'schizophrenia', 'bipolar', 'autism', 'adhd', 'sleep', 'insomnia', 'migraine', 'neurodegenerative', 'memory', 'educational', 'dopamine', 'serotonin'],
  },
  {
    id: 'immune',
    label: 'Immune & Inflammatory',
    keywords: ['autoimmune', 'inflammatory', 'inflammation', 'immune', 'rheumatoid', 'lupus', 'crohn', 'colitis', 'psoriasis', 'celiac', 'allergy', 'asthma', 'cytokine', 'interferon', 'ibd', 'eczema', 'sarcoidosis', 'vasculitis', 'pemphigoid'],
  },
  {
    id: 'musculoskeletal',
    label: 'Musculoskeletal',
    keywords: ['bone', 'osteoporosis', 'fracture', 'arthritis', 'osteoarthritis', 'muscle', 'tendon', 'joint', 'spine', 'lumbar', 'hip', 'knee', 'density', 'scoliosis', 'gout'],
  },
  {
    id: 'cancer',
    label: 'Cancer Susceptibility',
    keywords: ['cancer', 'carcinoma', 'tumor', 'melanoma', 'leukemia', 'lymphoma', 'glioma', 'adenocarcinoma', 'malignant', 'neoplasm', 'prostate', 'breast', 'colorectal', 'ovarian', 'cervical', 'basal', 'squamous'],
  },
];

export const DOMAIN_LABELS: Record<string, string> = Object.fromEntries(
  DOMAINS.map(d => [d.id, d.label])
);

// ── Helpers ──

function isCredibleOR(r: SavedResult): boolean {
  return r.effectType === 'OR' && r.riskScore > 0.1 && r.riskScore < 10;
}

function effectMagnitude(r: SavedResult): number {
  if (!r.riskScore || r.riskScore <= 0) return 0;
  return Math.abs(Math.log(r.riskScore));
}

function domainScore(keywords: string[], traitName: string): number {
  const trait = traitName.toLowerCase();
  return keywords.reduce((sum, kw) => sum + (trait.includes(kw) ? 1 : 0), 0);
}

function pValueTier(r: SavedResult): string {
  const mlog = parseFloat(r.pValueMlog ?? '');
  if (isNaN(mlog)) return '';
  if (mlog >= 10) return ' | p: very strong';
  if (mlog >= 7.3) return ' | p: strong';
  if (mlog >= 5) return ' | p: moderate';
  return ' | p: suggestive';
}

function formatResult(r: DomainResult): string {
  const dir = r.riskLevel === 'increased' ? '↑' : r.riskLevel === 'decreased' ? '↓' : '→';
  const effect = `OR ${r.riskScore.toFixed(2)}x ${dir}`;
  const gene = r.mappedGene ? ` | gene: ${r.mappedGene}` : '';
  const snp = r.matchedSnp ? ` | snp: ${r.matchedSnp}` : '';
  const genotype = r.userGenotype ? ` | genotype: ${r.userGenotype}${r.riskAllele ? ` (risk allele: ${r.riskAllele})` : ''}` : '';
  const pv = pValueTier(r);
  return `${r.traitName} | ${effect}${gene}${snp}${genotype}${pv}`;
}

// ── Selection ──

function selectByDomain(results: SavedResult[]): {
  selected: DomainResult[];
  counts: Record<string, { elevated: number; protective: number }>;
} {
  const allSelected: DomainResult[] = [];
  const counts: Record<string, { elevated: number; protective: number }> = {};
  const credible = results.filter(isCredibleOR);
  const usedStudyIds = new Set<number>();

  // Assign each result to the domain where it scores highest. This prevents
  // the same study appearing in multiple domain sections and bloating the prompt.
  const domainAssignments = new Map<number, string>();
  for (const r of credible) {
    let bestDomain = '';
    let bestScore = 0;
    for (const domain of DOMAINS) {
      const score = domainScore(domain.keywords, r.traitName);
      if (score > bestScore) { bestScore = score; bestDomain = domain.id; }
    }
    if (bestDomain) domainAssignments.set(r.studyId, bestDomain);
  }

  for (const domain of DOMAINS) {
    const matching = credible
      .filter(r => domainAssignments.get(r.studyId) === domain.id)
      .sort((a, b) => effectMagnitude(b) - effectMagnitude(a));

    const elevated = matching.filter(r => r.riskLevel === 'increased').slice(0, 15);
    const protective = matching.filter(r => r.riskLevel === 'decreased').slice(0, 8);

    elevated.concat(protective).forEach(r => {
      allSelected.push({ ...r, domain: domain.id });
      usedStudyIds.add(r.studyId);
    });
    counts[domain.id] = { elevated: elevated.length, protective: protective.length };
  }

  return { selected: allSelected, counts };
}

// ── Prompt ──

function buildPrompt(
  selected: DomainResult[],
  counts: Record<string, { elevated: number; protective: number }>,
  customization: any
): string {
  const userCtx = buildUserContextString(customization);

  const personalConditions: string[] = customization?.personalConditions ?? [];
  const familyConditions: string[] = customization?.familyConditions ?? [];
  const hasHealthHistory = personalConditions.length > 0 || familyConditions.length > 0;

  const healthHistorySection = hasHealthHistory ? `
HEALTH HISTORY:
${personalConditions.map(c => `- Personal: ${c}`).join('\n')}
${familyConditions.map(c => `- Family: ${c}`).join('\n')}
` : '';

  const domainSections = DOMAINS
    .filter(d => (counts[d.id]?.elevated ?? 0) + (counts[d.id]?.protective ?? 0) >= 2)
    .map(d => {
      const domainResults = selected.filter(r => r.domain === d.id);
      const elevated = domainResults.filter(r => r.riskLevel === 'increased');
      const protective = domainResults.filter(r => r.riskLevel === 'decreased');
      const parts: string[] = [];
      if (elevated.length > 0) parts.push(`Elevated (${elevated.length}):\n${elevated.map(formatResult).join('\n')}`);
      if (protective.length > 0) parts.push(`Protective (${protective.length}):\n${protective.map(formatResult).join('\n')}`);
      return `## ${d.label.toUpperCase()}\n${parts.join('\n')}`;
    })
    .join('\n\n');

  const healthHistoryNote = hasHealthHistory
    ? `Use the health history to anchor the report: note where genetic signals reinforce known conditions, where they diverge, and which findings the user is unlikely to have encountered from their symptoms alone.`
    : `No health history provided. Focus on the strongest and most surprising signals.`;

  return `You are writing a personalized genetic healthspan report. The reader is not a scientist but is curious and health-conscious. Write the way a knowledgeable friend who happens to be a geneticist would explain this: clear, specific, and honest about uncertainty. These are population-level statistics; use "population studies associate" / "carriers show" throughout, never deterministic claims.
${userCtx}
${healthHistorySection}
DATA FORMAT: Trait | Effect size (↑ elevated / ↓ protective) | Gene | SNP (rsID) | Genotype (risk allele) | Statistical confidence

${domainSections}

${healthHistoryNote}

Structure the report as follows. Do NOT use the domain names as section headers:

**Your aging profile** (write this first)
2-3 sentences. What are the 1-2 most important things to understand about this person's genetic aging biology? Be direct and specific. This is the executive summary a non-scientist will actually remember.

**Key findings** (3-4 findings, each as a named header + 2-3 paragraphs)
Choose the 3-4 most important and interesting genetic themes across ALL domains combined. These should be the signals that matter most for long-term healthspan — the things a person would actually want to know and think about. Each finding should:
- Have a short, plain-English header (e.g., "Metabolic-cardiovascular tension", "Cognitive aging and APOE", "Immune system tuning")
- Open with a one-sentence plain statement of what the finding is
- Explain the biology in 2 paragraphs: what the gene or pathway does, what the signal pattern suggests, and why it matters for aging
- ${hasHealthHistory ? 'Connect explicitly to the user\'s health history when relevant' : 'Focus on what is most surprising or actionable from a healthspan perspective'}
- Skip pseudogenes (LINC, LOC, MIR) entirely

**Other signals worth noting** (1 short paragraph)
Briefly mention 2-3 additional signals from domains not covered in Key findings. One sentence each. This gives breadth without diluting the main findings.

**What to understand about your aging biology**
4 genes, each with a 1-sentence hook explaining WHY it matters for how the body ages, not just what trait it is associated with. Write these for someone who will go and search for more.

**Hypotheses about you** (4 hypotheses, each 2-3 sentences)
Based on the patterns across these healthspan signals, write 4 specific hypotheses about this person's biology or lived experience. Each should be a concrete statement grounded in the findings. Frame each as "People with this signal pattern tend to..." or "This combination of variants is consistent with someone who...". Be direct and specific. These should feel like insights, not disclaimers. Reference specific genes or findings from this report.

Style rules:
- No domain-name headers in the body of the report.
- The "Key findings" headers should describe the biological theme, not the domain (e.g., "The metabolic-inflammatory axis" not "Cardiovascular").
- Write for someone who wants to understand their biology, not catalog it.
- When citing a specific variant, include the rsID where available (e.g., "rs429358, an APOE variant"). Where the genotype is informative, note it: "heterozygous for the risk allele" vs "homozygous."
- Population-level language; never "your genome does X."
- Do not recommend clinical tests, doctors, or lifestyle changes.
- 800-1000 words total

After the report, append exactly this block (required, verbatim format):

CHAT_QUESTIONS:
- [a specific question about a key finding, gene, or SNP from this report]
- [a question about how two signals or domains connect]
- [a question about what a specific genotype or protective signal means]
- [a question about the biology behind a surprising or cross-domain finding]
- [a question about a gene worth researching further]

Questions must reference specific genes, rsIDs, or findings from this report. Write them as the user would ask them.`;
}

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
        content: 'You are a science writer with deep genetics knowledge. Write engagingly for a reader who understands GWAS but wants insight, not inventory. Use population-level language ("population studies associate", "carriers show") but keep it fluid, not bureaucratic. Never add a disclaimer paragraph at the top; focus entirely on what is scientifically interesting. Do not recommend clinical tests, doctors, or healthcare appointments.',
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 10000, temperature: 0.3, reasoningEffort: 'medium' }
  );

  if (!response.content) throw new Error('No report generated.');

  const [reportText, questionsBlock] = response.content.split(/\n+CHAT_QUESTIONS:\n/);
  const questions = questionsBlock
    ? questionsBlock.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(Boolean)
    : [];

  onProgress({ phase: 'complete', message: 'Done', progress: 100 });
  return { report: reportText.trim(), selected, domainCounts: counts, questions };
}
