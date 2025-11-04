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
    const { messages, max_tokens } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid messages format' },
        { status: 400 }
      );
    }

    console.log('[OpenAI API] Calling model: gpt-5-mini with max_completion_tokens:', max_tokens || 1500);

    // Use gpt-5-mini for fast, high-quality analysis
    const completion = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_completion_tokens: max_tokens || 1500,  // gpt-5 uses max_completion_tokens, no temperature parameter
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
