import { NextRequest, NextResponse } from 'next/server';
import {Signer, NilauthClient, Builder as NucTokenBuilder, Did, Builder, Command} from '@nillion/nuc';
import {NucCmd, SecretVaultBuilderClient } from '@nillion/secretvaults';
import { validateOrigin } from '@/lib/origin-validator';
import { NILDB_CONFIG } from '@/lib/nildb-config';

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

    const { userDid } = await request.json();

    if (!userDid) {
      return NextResponse.json(
        { error: 'User DID is required' },
        { status: 400 }
      );
    }

    // Check for Nillion API key
    const apiKey = process.env.NILLION_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Nillion API key not configured. Please set NILLION_API_KEY in your environment variables.' },
        { status: 503 }
      );
    }

    console.log('Creating nilDB delegation token for user:', userDid);

    // Create signer from API key
    const builderSigner = await Signer.fromPrivateKey(apiKey, "nil");
    const builderDid = await builderSigner.getDid();

    // Create Nilauth client manually using the provided public key
    // (avoiding network call to /about endpoint)
    const nilauthClient = new NilauthClient({
      payer: builderSigner,
      nilauth: {
        baseUrl: NILDB_CONFIG.nilauthUrl,
        publicKey: NILDB_CONFIG.nilauthPublicKey,
        did: Did.fromPublicKey(NILDB_CONFIG.nilauthPublicKey, 'key')
      }
    });

    // Create builder client
    console.log('Creating SecretVaultBuilderClient with', NILDB_CONFIG.nodes.length, 'nodes');
    const builderClient = await SecretVaultBuilderClient.from({
      signer: builderSigner,
      nilauthClient,
      dbs: NILDB_CONFIG.nodes
    });
    console.log('SecretVaultBuilderClient created successfully');

    // Refresh authentication to get root token
    console.log('Refreshing root token from nilauth...');
    try {
      await builderClient.refreshRootToken();
      console.log('Root token refreshed successfully');
    } catch (err) {
      console.error('Failed to refresh root token:', err);
      throw new Error(`Failed to refresh root token: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Get the root token
    const rootToken = builderClient.rootToken;
    if (!rootToken) {
      throw new Error('No root token available from builderClient');
    }

    // Create delegation token from builderClient to user
    // Token expires in 10 minutes - enough time for user to submit data
    const expiresInSeconds = 10 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    /*// Create delegation token from builderClient to user
    // Don't specify command - let the user client add it
    // Note: Using signer.privateKey() since builderClient.keypair is not exposed in current API
    const delegationToken = new NucTokenBuilder()
      .extending(rootToken)
      .audience(userDid)
      .expiresAt(expiresAt)
      .build(signer.privateKey());*/

    const delegationToken = await Builder.delegationFrom(builderClient.rootToken)
        .command(NucCmd.nil.db.data.create as Command)
        .audience(userDid)
        .expiresIn(3600)
        .signAndSerialize(builderSigner);

    console.log('nilDB delegation token created successfully');

    return NextResponse.json({
      success: true,
      delegationToken,
      collectionId: NILDB_CONFIG.collectionId,
      builderDid: builderDid.didString
    });

  } catch (error) {
    console.error('Error creating nilDB delegation token:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create delegation token' },
      { status: 500 }
    );
  }
}
