import { callLLM, callLLMStream, LLMMessage } from './llm-client';
import { SavedResult } from './results-manager';

export type ResearchAngle = { keyword: string; resultsCount: number };

const ITERATIONS = 10;
const RAG_LIMIT = 100;

function formatRiskScore(score: number, level: string, effectType?: 'OR' | 'beta'): string {
  if (level === 'neutral') return effectType === 'beta' ? 'baseline' : '1.0x';
  if (effectType === 'beta') return `β=${score >= 0 ? '+' : ''}${score.toFixed(3)} units`;
  return `${score.toFixed(2)}x`;
}

function formatResults(results: SavedResult[]): string {
  return results
    .map((r, idx) =>
      `${idx + 1}. ${r.traitName} (${r.studyTitle}):
   - Your genotype: ${r.userGenotype}
   - Risk allele: ${r.riskAllele}
   - Risk score: ${formatRiskScore(r.riskScore, r.riskLevel, r.effectType)} (${r.riskLevel})
   - SNP: ${r.matchedSnp}`
    )
    .join('\n\n');
}

export async function* runResearchPipeline(
  query: string,
  customizationSummary: string,
  totalResults: number,
  getTopResultsByRelevance: (q: string, limit: number) => Promise<SavedResult[]>,
  onStatus: (status: string) => void,
  llmDescription: string,
  onMeta?: (angles: ResearchAngle[]) => void,
): AsyncGenerator<string> {
  // Step 1: Extract keyword angles
  onStatus('Extracting research angles...');

  const keywordMessages: LLMMessage[] = [
    {
      role: 'system',
      content: `You extract GWAS database search keywords from a user's question about their genetics.

RULES:
- Output exactly ${ITERATIONS} keywords or short phrases, one per line, no numbering, no explanation.
- Keywords must reflect the TOPIC of the question — the biological traits, phenotypes, or mechanisms being asked about.
- Do NOT use the user's medical conditions as keywords unless the question is directly asking about those conditions.
- The user context is provided only to help you pick the most relevant angles within the question's topic. It must not redirect the keywords toward unrelated health conditions.
- Be specific. "Bitter taste receptor TAS2R" is better than "taste preferences".

EXAMPLE: If the question is "What foods will I like?" extract keywords about food preference genetics (taste receptors, flavor perception, olfaction, dietary patterns, food aversion). NOT about diabetes or autoimmune disease.`,
    },
    {
      role: 'user',
      content: `User question: "${query}"\n\nUser context (for prioritization only, do not redirect keywords):\n${customizationSummary || 'No personalization set.'}`,
    },
  ];

  const keywordResponse = await callLLM(keywordMessages, { maxTokens: 150, temperature: 0.5 });

  const keywords = keywordResponse.content
    .split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 0)
    .slice(0, ITERATIONS);

  if (keywords.length === 0) keywords.push(query);

  // Step 2: Sequential RAG + focused analysis for each angle (avoids hammering nilAI)
  const analyses: { keyword: string; analysis: string; resultsCount: number }[] = [];

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    onStatus(`Angle ${i + 1}/${keywords.length}: ${keyword}...`);

    const results = await getTopResultsByRelevance(keyword, RAG_LIMIT);

    if (results.length === 0) {
      analyses.push({ keyword, analysis: 'No relevant findings for this angle.', resultsCount: 0 });
      continue;
    }

    const analysisMessages: LLMMessage[] = [
      {
        role: 'system',
        content: `You analyze GWAS genetic findings for a specific research angle. ${llmDescription}

USER CONTEXT:
${customizationSummary || 'No personalization set.'}

ORIGINAL USER QUESTION: "${query}"

RESEARCH ANGLE: "${keyword}"

GWAS FINDINGS:
${formatResults(results)}

Write a focused 150-word analysis of what these findings mean for this user, specific to the "${keyword}" angle. Reference actual findings by trait name and OR/beta values. Be concrete and personalized. No disclaimers needed here.`,
      },
      {
        role: 'user',
        content: `Analyze the "${keyword}" angle.`,
      },
    ];

    const response = await callLLM(analysisMessages, { maxTokens: 350, temperature: 0.6 });
    analyses.push({ keyword, analysis: response.content, resultsCount: results.length });
  }

  onMeta?.(analyses.map(a => ({ keyword: a.keyword, resultsCount: a.resultsCount })));

  // Step 3: Stream comprehensive synthesis
  onStatus('Synthesizing findings...');

  const analysesText = analyses
    .map(a => `**Angle: ${a.keyword}** (${a.resultsCount} studies)\n${a.analysis}`)
    .join('\n\n');

  const synthesisMessages: LLMMessage[] = [
    {
      role: 'system',
      content: `You synthesize multi-angle genetic research into a comprehensive personalized answer. ${llmDescription}

USER CONTEXT:
${customizationSummary || 'No personalization set.'}

Total results in user profile: ${totalResults.toLocaleString()}

RESEARCH ANALYSES (${analyses.length} angles):
${analysesText}

Synthesize these analyses into a comprehensive answer to the user's question. Identify patterns across angles, highlight convergent findings, note what stands out given the user's context. Use the standard structure: overview, genetic landscape, personal implications, action steps. Target 600-900 words. Plain language. Complete your full response.

GWAS results show statistical associations at the population level, not deterministic outcomes. Educational purposes only.

After the response, append exactly this block:

FOLLOWUP:
- [question from the user's perspective connecting a finding directly to their personal situation]
- [question digging deeper on the most impactful finding across the analyses]
- [question connecting two of the research angles or asking how they interact]`,
    },
    {
      role: 'user',
      content: query,
    },
  ];

  const stream = callLLMStream(synthesisMessages, {
    maxTokens: 3000,
    temperature: 0.7,
    reasoningEffort: 'medium',
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}
