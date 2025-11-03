/**
 * OpenAI Chat API Endpoint
 *
 * Server-side proxy for OpenAI API calls.
 * Used for Overview Report generation as alternative to nilAI.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { messages, max_tokens, temperature } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid messages format' },
        { status: 400 }
      );
    }

    // Use GPT-4o with 128k context window
    // Note: To use gpt-5-nano, check OpenAI docs for model ID and API compatibility
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',  // 128k context window, faster than turbo
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: max_tokens || 1500,
      temperature: temperature || 0.7,
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No content in response' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      content,
      usage: completion.usage,
    });

  } catch (error: any) {
    console.error('[OpenAI API] Error:', error);

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

    return NextResponse.json(
      { error: error?.message || 'OpenAI API error' },
      { status: error?.status || 500 }
    );
  }
}
