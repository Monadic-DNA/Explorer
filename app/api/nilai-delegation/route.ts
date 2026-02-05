import { NextRequest, NextResponse } from 'next/server';
import { DelegationTokenServer } from '@nillion/nilai-ts';
import { validateOrigin } from '@/lib/origin-validator';

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5; // 5 tokens per minute per IP

function getRateLimitKey(request: NextRequest): string {
  // Try to get real IP from common headers (for proxies/load balancers)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0] || realIp || 'unknown';
  return ip;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    // New window
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  record.count++;
  return false;
}

// Validate delegation request structure
function isValidDelegationRequest(delegationRequest: any): boolean {
  if (!delegationRequest || typeof delegationRequest !== 'object') {
    return false;
  }

  // The delegation request should be a non-empty object from NilAI SDK
  // We're being lenient here since the SDK structure may vary
  // The main check is that it's a valid object with some properties
  const keys = Object.keys(delegationRequest);
  if (keys.length === 0) {
    return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    // Validate origin
    const originError = validateOrigin(request);
    if (originError) return originError;

    // Rate limiting check
    const rateLimitKey = getRateLimitKey(request);
    if (isRateLimited(rateLimitKey)) {
      console.warn(`Rate limit exceeded for IP: ${rateLimitKey}`);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const { delegationRequest } = await request.json();

    if (!delegationRequest) {
      return NextResponse.json(
        { error: 'Delegation request is required' },
        { status: 400 }
      );
    }

    // Validate delegation request structure
    if (!isValidDelegationRequest(delegationRequest)) {
      console.warn(`Invalid delegation request from IP: ${rateLimitKey}`, delegationRequest);
      return NextResponse.json(
        { error: 'Invalid delegation request format' },
        { status: 400 }
      );
    }

    console.log('Valid delegation request received:', Object.keys(delegationRequest));

    // Check for NilAI API key
    const apiKey = process.env.NILLION_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'NilAI API key not configured. Please set NILLION_API_KEY in your environment variables.' },
        { status: 503 }
      );
    }

    // Create delegation token server
    const server = new DelegationTokenServer(apiKey, {
      expirationTime: 600, // 10 minutes validity
      tokenMaxUses: 1 // Single use for privacy (fresh token fetched per message)
    });

    // Generate delegation token
    const delegationToken = await server.createDelegationToken(delegationRequest);

    return NextResponse.json({
      success: true,
      delegationToken,
    });

  } catch (error) {
    console.error('Error creating delegation token:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create delegation token' },
      { status: 500 }
    );
  }
}
