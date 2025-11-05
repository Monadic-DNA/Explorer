/**
 * Centralized LLM Client
 *
 * Handles all LLM API calls based on configured provider.
 * All data is sent directly from client to LLM service - never through our server.
 */

import { NilaiOpenAIClient, AuthType, NilAuthInstance } from '@nillion/nilai-ts';
import { getAIConfig, getModelIdentifier, getAPIEndpoint } from './ai-config';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call LLM with messages - client-side only, respects user's provider choice
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const config = getAIConfig();
  const { maxTokens = 1000, temperature = 0.7 } = options;

  console.log(`[LLM Client] Using provider: ${config.provider}, model: ${config.model}`);
  
  // Log first 20 lines of the prompt
  const fullPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
  const promptLines = fullPrompt.split('\n');
  const previewLines = promptLines.slice(0, 20);
  console.log(`[LLM Client] Prompt preview (first 20 lines):\n${previewLines.join('\n')}`);

  switch (config.provider) {
    case 'nilai':
      return await callNilAI(messages, maxTokens, temperature);

    case 'ollama':
      return await callOllama(messages, maxTokens, temperature, config.ollamaAddress, config.ollamaPort, config.model);

    case 'huggingface':
      if (!config.huggingfaceApiKey) {
        throw new Error('HuggingFace API key not configured');
      }
      return await callHuggingFace(messages, maxTokens, temperature, config.huggingfaceApiKey);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Call Nillion nilAI (privacy-preserving TEE)
 */
async function callNilAI(
  messages: LLMMessage[],
  maxTokens: number,
  temperature: number
): Promise<LLMResponse> {
  // Initialize client
  const client = new NilaiOpenAIClient({
    baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
    authType: AuthType.DELEGATION_TOKEN,
    nilauthInstance: NilAuthInstance.PRODUCTION,
  });

  // Get delegation token from server
  const delegationRequest = client.getDelegationRequest();

  const tokenResponse = await fetch('/api/nilai-delegation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delegationRequest }),
  });

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.json();
    throw new Error(errorData.error || 'Failed to get delegation token');
  }

  const { delegationToken } = await tokenResponse.json();
  client.updateDelegation(delegationToken);

  // Call nilAI
  const response = await client.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: messages as any,
    max_tokens: maxTokens,
    temperature,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No response from nilAI');
  }

  return {
    content,
    usage: response.usage as any,
  };
}

/**
 * Call Ollama (local model)
 */
async function callOllama(
  messages: LLMMessage[],
  maxTokens: number,
  temperature: number,
  address?: string,
  port?: number,
  model?: string
): Promise<LLMResponse> {
  const baseURL = `http://${address || 'localhost'}:${port || 11434}`;
  const modelName = model || 'gpt-oss:latest';

  // Extract prompt from messages
  const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');

  const response = await fetch(`${baseURL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const data = await response.json();
  
  // ONLY use the response field - this contains the actual output
  // The thinking field contains internal reasoning and should be ignored
  const content = data.response || '';

  if (!content) {
    console.error('[Ollama] Response data:', data);
    console.error('[Ollama] Thinking field length:', data.thinking?.length || 0);
    throw new Error('No response from Ollama - response field is empty (thinking field is ignored)');
  }

  console.log(`[Ollama] Response length: ${content.length} chars, done_reason: ${data.done_reason || 'none'}`);

  return {
    content,
    usage: {
      prompt_tokens: data.prompt_eval_count || 0,
      completion_tokens: data.eval_count || 0,
      total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    },
  };
}

/**
 * Call HuggingFace Router
 */
async function callHuggingFace(
  messages: LLMMessage[],
  maxTokens: number,
  temperature: number,
  apiKey: string
): Promise<LLMResponse> {
  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b:together',
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HuggingFace error: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No response from HuggingFace');
  }

  return {
    content,
    usage: data.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * Get a user-friendly description of the current LLM configuration
 */
export function getLLMDescription(): string {
  const config = getAIConfig();

  switch (config.provider) {
    case 'nilai':
      return `🛡️ Powered by Nillion nilAI using ${config.model} in TEE (Trusted Execution Environment)`;
    case 'ollama':
      return `🖥️ Using local Ollama (${config.model}) at ${config.ollamaAddress || 'localhost'}:${config.ollamaPort || 11434}`;
    case 'huggingface':
      return `☁️ Using HuggingFace Router (${config.model})`;
    default:
      return 'AI analysis';
  }
}
