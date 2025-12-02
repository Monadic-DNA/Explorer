/**
 * Centralized LLM Client
 *
 * Handles all LLM API calls based on configured provider.
 * All data is sent directly from client to LLM service - never through our server.
 */

import { NilaiOpenAIClient, AuthType, NilAuthInstance } from '@nillion/nilai-ts';
import { getLLMConfig, getModelIdentifier, getAPIEndpoint } from './llm-config';

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
    reasoning_tokens?: number;  // For reasoning models
  };
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/**
 * Call LLM with messages - client-side only, respects user's provider choice
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const config = getLLMConfig();
  const modelId = getModelIdentifier(config);
  const { maxTokens, temperature = 0.7, reasoningEffort = 'medium' } = options;

  // Calculate prompt length for logging
  // NOTE: Token-to-character ratio varies significantly by content type:
  //   - Structured genetic data (pipe-delimited, SNP IDs, gene names): ~10 chars/token
  //   - English prose output: ~3 chars/token
  //   - General rule for this app: ~6-8 chars/token (mixed content)
  // We log actual token counts from the model rather than estimating, and show
  // the actual chars/token ratio in the response logs for transparency.
  //
  // IMPORTANT: If you see extremely high chars/token ratios (>20), the input is likely
  // being truncated due to context window limits. For Ollama, ensure num_ctx is set
  // to the model's full context window (131072 for gpt-oss-20b).
  const fullPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
  const promptChars = fullPrompt.length;

  // Log comprehensive request details
  console.log(`
╔═══════════════════════════════════════════════════════════════
║ LLM REQUEST START
╠═══════════════════════════════════════════════════════════════
║ Provider: ${config.provider}
║ Model: ${modelId}
║ Max Output Tokens: ${maxTokens !== undefined ? maxTokens.toLocaleString() : 'unlimited (model max)'}
║ Reasoning Effort: ${reasoningEffort}
║ Temperature: ${temperature}
║ Prompt Size: ${promptChars.toLocaleString()} characters
╠═══════════════════════════════════════════════════════════════
║ PROMPT PREVIEW (First 50 lines):
╠═══════════════════════════════════════════════════════════════`);

  const promptLines = fullPrompt.split('\n');
  const previewLines = promptLines.slice(0, 50);
  previewLines.forEach(line => {
    console.log(`║ ${line}`);
  });

  if (promptLines.length > 50) {
    console.log(`║ ... (${promptLines.length - 50} more lines omitted)`);
  }

  console.log(`╚═══════════════════════════════════════════════════════════════`);

  // Start timing
  const startTime = Date.now();

  let response: LLMResponse;

  try {
    switch (config.provider) {
      case 'nilai':
        response = await callNilAI(messages, maxTokens, temperature, reasoningEffort, modelId);
        break;

      case 'ollama':
        response = await callOllama(messages, maxTokens, temperature, reasoningEffort, config.ollamaAddress, config.ollamaPort, modelId);
        break;

      case 'huggingface':
        if (!config.huggingfaceApiKey) {
          throw new Error('HuggingFace API key not configured');
        }
        response = await callHuggingFace(messages, maxTokens, temperature, reasoningEffort, config.huggingfaceApiKey, modelId);
        break;

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    // Calculate elapsed time
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(2);

    // Calculate token ratios
    const inputTokenRatio = response.usage?.prompt_tokens ? (promptChars / response.usage.prompt_tokens).toFixed(1) : 'N/A';
    const outputTokenRatio = response.usage?.completion_tokens ? (response.content.length / response.usage.completion_tokens).toFixed(1) : 'N/A';

    // Log comprehensive response details
    console.log(`
╔═══════════════════════════════════════════════════════════════
║ LLM RESPONSE SUCCESS
╠═══════════════════════════════════════════════════════════════
║ Provider: ${config.provider}
║ Model: ${modelId}
║ Time Taken: ${elapsedSeconds}s (${elapsedMs}ms)
║ Reasoning Effort: ${reasoningEffort}
╠═══════════════════════════════════════════════════════════════
║ TOKEN USAGE:
║   Input: ${response.usage?.prompt_tokens?.toLocaleString() || 'N/A'} tokens (${promptChars.toLocaleString()} chars, ${inputTokenRatio} chars/token)
║   Output: ${response.usage?.completion_tokens?.toLocaleString() || 'N/A'} tokens (${response.content.length.toLocaleString()} chars, ${outputTokenRatio} chars/token)
║   Reasoning: ${(response.usage as any)?.reasoning_tokens?.toLocaleString() || 'Not reported'} tokens
║   Total: ${response.usage?.total_tokens?.toLocaleString() || 'N/A'} tokens
╠═══════════════════════════════════════════════════════════════
║ Tokens/Second: ${response.usage?.completion_tokens ? (response.usage.completion_tokens / (elapsedMs / 1000)).toFixed(2) : 'N/A'}
╚═══════════════════════════════════════════════════════════════`);

    return response;
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(2);

    console.error(`
╔═══════════════════════════════════════════════════════════════
║ LLM REQUEST FAILED
╠═══════════════════════════════════════════════════════════════
║ Provider: ${config.provider}
║ Model: ${modelId}
║ Time Taken: ${elapsedSeconds}s before failure
║ Error: ${error instanceof Error ? error.message : String(error)}
╚═══════════════════════════════════════════════════════════════`);

    throw error;
  }
}

/**
 * Call Nillion nilAI (privacy-preserving TEE)
 */
async function callNilAI(
  messages: LLMMessage[],
  maxTokens: number | undefined,
  temperature: number,
  reasoningEffort: 'low' | 'medium' | 'high',
  modelId: string
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
    model: modelId,
    messages: messages as any,
    max_tokens: maxTokens || 131072, // Default to model max if not specified
    temperature,
    reasoning_effort: reasoningEffort,
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
  maxTokens: number | undefined,
  temperature: number,
  reasoningEffort: 'low' | 'medium' | 'high',
  address?: string,
  port?: number,
  modelId?: string
): Promise<LLMResponse> {
  const baseURL = `http://${address || 'localhost'}:${port || 11434}`;
  const modelName = modelId || 'gpt-oss:latest';

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
        num_ctx: 131072, // Context window size (CRITICAL: Ollama defaults to 2048, must set to model max)
        num_predict: maxTokens || 131072, // Max output tokens (default to model max if not specified)
        temperature,
        reasoning_effort: reasoningEffort,
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

  // Calculate reasoning tokens if thinking field is present
  const reasoningTokens = data.thinking ? Math.ceil(data.thinking.length / 4) : undefined;

  return {
    content,
    usage: {
      prompt_tokens: data.prompt_eval_count || 0,
      completion_tokens: data.eval_count || 0,
      total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      reasoning_tokens: reasoningTokens,
    },
  };
}

/**
 * Call HuggingFace Router
 */
async function callHuggingFace(
  messages: LLMMessage[],
  maxTokens: number | undefined,
  temperature: number,
  reasoningEffort: 'low' | 'medium' | 'high',
  apiKey: string,
  modelId: string
): Promise<LLMResponse> {
  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: maxTokens || 131072, // Default to model max if not specified
      temperature,
      reasoning_effort: reasoningEffort,
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
 * Call LLM with streaming support - yields content chunks as they arrive
 */
export async function* callLLMStream(
  messages: LLMMessage[],
  options: LLMOptions = {}
): AsyncGenerator<string, void, unknown> {
  const config = getLLMConfig();
  const modelId = getModelIdentifier(config);
  const { maxTokens, temperature = 0.7, reasoningEffort = 'medium' } = options;

  console.log(`[LLM Stream] Starting stream with provider: ${config.provider}, model: ${modelId}`);
  const startTime = Date.now();

  try {
    switch (config.provider) {
      case 'nilai':
        yield* streamNilAI(messages, maxTokens, temperature, reasoningEffort, modelId);
        break;

      case 'ollama':
        yield* streamOllama(messages, maxTokens, temperature, reasoningEffort, config.ollamaAddress, config.ollamaPort, modelId);
        break;

      case 'huggingface':
        if (!config.huggingfaceApiKey) {
          throw new Error('HuggingFace API key not configured');
        }
        yield* streamHuggingFace(messages, maxTokens, temperature, reasoningEffort, config.huggingfaceApiKey, modelId);
        break;

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[LLM Stream] Stream completed in ${(elapsedMs / 1000).toFixed(2)}s`);
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    console.error(`[LLM Stream] Stream failed after ${(elapsedMs / 1000).toFixed(2)}s:`, error);
    throw error;
  }
}

/**
 * Stream from Nillion nilAI
 */
async function* streamNilAI(
  messages: LLMMessage[],
  maxTokens: number | undefined,
  temperature: number,
  reasoningEffort: 'low' | 'medium' | 'high',
  modelId: string
): AsyncGenerator<string, void, unknown> {
  const client = new NilaiOpenAIClient({
    baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
    authType: AuthType.DELEGATION_TOKEN,
    nilauthInstance: NilAuthInstance.PRODUCTION,
  });

  // Get delegation token
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

  // Call nilAI with streaming
  const stream = await client.chat.completions.create({
    model: modelId,
    messages: messages as any,
    max_tokens: maxTokens || 131072,
    temperature,
    reasoning_effort: reasoningEffort,
    stream: true,
  });

  // Yield chunks as they arrive
  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

/**
 * Stream from Ollama
 */
async function* streamOllama(
  messages: LLMMessage[],
  maxTokens: number | undefined,
  temperature: number,
  reasoningEffort: 'low' | 'medium' | 'high',
  address?: string,
  port?: number,
  modelId?: string
): AsyncGenerator<string, void, unknown> {
  const baseURL = `http://${address || 'localhost'}:${port || 11434}`;
  const modelName = modelId || 'gpt-oss:latest';

  const response = await fetch(`${baseURL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        num_ctx: 131072,
        num_predict: maxTokens || 131072,
        temperature,
        reasoning_effort: reasoningEffort,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('No response body from Ollama');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch (e) {
          console.warn('[Ollama Stream] Failed to parse line:', line);
        }
      }
    }
  }
}

/**
 * Stream from HuggingFace
 */
async function* streamHuggingFace(
  messages: LLMMessage[],
  maxTokens: number | undefined,
  temperature: number,
  reasoningEffort: 'low' | 'medium' | 'high',
  apiKey: string,
  modelId: string
): AsyncGenerator<string, void, unknown> {
  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: maxTokens || 131072,
      temperature,
      reasoning_effort: reasoningEffort,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HuggingFace error: ${response.statusText} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No response body from HuggingFace');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch (e) {
          console.warn('[HuggingFace Stream] Failed to parse line:', line);
        }
      }
    }
  }
}

/**
 * Get a user-friendly description of the current LLM configuration
 */
export function getLLMDescription(): string {
  const config = getLLMConfig();
  const modelId = getModelIdentifier(config);

  switch (config.provider) {
    case 'nilai':
      return `🛡️ Powered by Nillion nilAI using ${modelId} in TEE (Trusted Execution Environment)`;
    case 'ollama':
      return `🖥️ Using local Ollama (${modelId}) at ${config.ollamaAddress || 'localhost'}:${config.ollamaPort || 11434}`;
    case 'huggingface':
      return `☁️ Using HuggingFace Router (${modelId})`;
    default:
      return 'LLM analysis';
  }
}
