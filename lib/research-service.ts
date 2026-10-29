import { callLLM, callLLMStream, LLMMessage } from './llm-client';
import { SavedResult } from './results-manager';
import { coreCall } from './core';

const RAG_LIMIT = 100;

export type ResearchAngle = { keyword: string; resultsCount: number };

// Prompts come from the shared core so web, Android and iOS send identical requests.
type Prompt = { messages: LLMMessage[]; maxTokens: number; temperature: number; reasoningEffort?: 'low' | 'medium' | 'high' };

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

  const keywordPrompt = coreCall('research_keywords_prompt', { query, customization: customizationSummary }) as Prompt;
  const keywordResponse = await callLLM(keywordPrompt.messages, { maxTokens: keywordPrompt.maxTokens, temperature: keywordPrompt.temperature });
  const keywords = coreCall('research_parse_keywords', { content: keywordResponse.content, query }) as string[];

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

    const anglePrompt = coreCall('research_angle_prompt', { query, keyword, customization: customizationSummary, llmDescription, results }) as Prompt;
    const response = await callLLM(anglePrompt.messages, { maxTokens: anglePrompt.maxTokens, temperature: anglePrompt.temperature });
    analyses.push({ keyword, analysis: response.content, resultsCount: results.length });
  }

  onMeta?.(analyses.map(a => ({ keyword: a.keyword, resultsCount: a.resultsCount })));

  // Step 3: Stream comprehensive synthesis
  onStatus('Synthesizing findings...');

  const synthesis = coreCall('research_synthesis_prompt', { query, customization: customizationSummary, llmDescription, totalResults, analyses }) as Prompt;
  const stream = callLLMStream(synthesis.messages, {
    maxTokens: synthesis.maxTokens,
    temperature: synthesis.temperature,
    reasoningEffort: synthesis.reasoningEffort,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}
