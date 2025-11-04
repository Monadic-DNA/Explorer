/**
 * OpenAI Chat API Endpoint
 *
 * Server-side proxy for OpenAI API calls OR local Ollama.
 * Used for Overview Report generation as alternative to nilAI.
 *
 * Set USE_LOCAL_MODEL=true in .env to use local Ollama instead of OpenAI.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Check if we should use local Ollama
const USE_LOCAL_MODEL = process.env.USE_LOCAL_MODEL === 'true';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// Initialize OpenAI client (used only if not using local model)
const openai = USE_LOCAL_MODEL ? null : new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Increase API route timeout to 20 minutes for long-running local model inference
export const maxDuration = 1200; // 20 minutes in seconds

export async function POST(request: NextRequest) {
  try {
    const { messages, max_tokens } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid messages format' },
        { status: 400 }
      );
    }

    // Route to local Ollama or OpenAI based on config
    if (USE_LOCAL_MODEL) {
      console.log('[Local Model] Calling gpt-oss:latest via Ollama with max_tokens:', max_tokens || 16000);

      // Extract the user message content
      const userMessage = messages[messages.length - 1];
      const prompt = typeof userMessage.content === 'string'
        ? userMessage.content
        : JSON.stringify(userMessage.content);

      // Call Ollama API with extended timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200000); // 20 minute timeout

      try {
        const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
          },
          body: JSON.stringify({
            model: 'gpt-oss:latest',
            prompt: prompt,
            stream: false,
            options: {
              num_predict: max_tokens,  // max tokens to generate (no fallback)
              num_ctx: 131072,  // Set context window explicitly (128k)
              stop: [],  // No custom stop sequences
            },
            tools: [],  // Explicitly disable tool calling
            format: '',  // No structured output format
          }),
          signal: controller.signal,
          // @ts-ignore - Node.js undici specific options
          keepalive: true,
          headersTimeout: 1200000, // 20 minutes in ms
          bodyTimeout: 1200000, // 20 minutes in ms
        });

        clearTimeout(timeout);

        if (!ollamaResponse.ok) {
          throw new Error(`Ollama API error: ${ollamaResponse.statusText}`);
        }

        const ollamaData = await ollamaResponse.json();

        console.log('[Local Model] Raw response keys:', Object.keys(ollamaData));
        console.log('[Local Model] done_reason:', ollamaData.done_reason);
        console.log('[Local Model] eval_count:', ollamaData.eval_count);

        const content = ollamaData.response;

        if (!content) {
          console.error('[Local Model] No content in response. Full data:', JSON.stringify(ollamaData, null, 2));
          return NextResponse.json(
            { error: 'No content in response from local model' },
            { status: 500 }
          );
        }

        console.log('[Local Model] Success, content length:', content.length);
        if (ollamaData.thinking) {
          console.log('[Local Model] Reasoning tokens used:', ollamaData.thinking.length);
        }

        return NextResponse.json({
          content,
          usage: {
            prompt_tokens: ollamaData.prompt_eval_count || 0,
            completion_tokens: ollamaData.eval_count || 0,
            total_tokens: (ollamaData.prompt_eval_count || 0) + (ollamaData.eval_count || 0),
          },
        });
      } catch (fetchError: any) {
        clearTimeout(timeout);
        if (fetchError.name === 'AbortError') {
          throw new Error('Ollama request timed out after 10 minutes');
        }
        throw fetchError;
      }
    }

    // Use OpenAI
    console.log('[OpenAI API] Calling model: gpt-5-mini with max_completion_tokens:', max_tokens || 16000);

    const completion = await openai!.chat.completions.create({
      model: 'gpt-5-mini',
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_completion_tokens: max_tokens || 16000,
    });

    console.log('[OpenAI API] Response received, choices:', completion.choices?.length);

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      console.error('[OpenAI API] No content in response. Full completion:', JSON.stringify(completion, null, 2));
      return NextResponse.json(
        { error: 'No content in response' },
        { status: 500 }
      );
    }

    console.log('[OpenAI API] Success, content length:', content.length);

    return NextResponse.json({
      content,
      usage: completion.usage,
    });

  } catch (error: any) {
    console.error('[OpenAI API] CAUGHT ERROR');
    console.error('[OpenAI API] Error type:', error?.constructor?.name);
    console.error('[OpenAI API] Error message:', error?.message);
    console.error('[OpenAI API] Error status:', error?.status);
    console.error('[OpenAI API] Error code:', error?.code);
    console.error('[OpenAI API] Full error object:', error);

    // Handle rate limits
    if (error?.status === 429) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    // Handle context length errors
    if (error?.code === 'context_length_exceeded') {
      return NextResponse.json(
        { error: `Context length exceeded: ${error.message}` },
        { status: 400 }
      );
    }

    // Handle invalid model errors
    if (error?.code === 'model_not_found' || error?.message?.includes('model')) {
      return NextResponse.json(
        { error: `Model error: ${error.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error?.message || error?.error?.message || 'OpenAI API error' },
      { status: error?.status || 500 }
    );
  }
}
