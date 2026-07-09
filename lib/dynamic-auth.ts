import { createRemoteJWKSet, jwtVerify } from 'jose';

// Server-side verification of Dynamic auth tokens.
// Dynamic signs a JWT for each logged-in user; the public keys are published
// at the environment's JWKS endpoint.

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(environmentId: string) {
  let jwks = jwksCache.get(environmentId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://app.dynamic.xyz/api/v0/sdk/${environmentId}/.well-known/jwks`)
    );
    jwksCache.set(environmentId, jwks);
  }
  return jwks;
}

export interface WalletAuthResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * Verifies that the request carries a valid Dynamic auth token whose
 * verified credentials include the given wallet address.
 */
export async function verifyWalletAuth(
  authorizationHeader: string | null,
  walletAddress: string
): Promise<WalletAuthResult> {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;
  if (!environmentId) {
    return { ok: false, error: 'Authentication is not configured', status: 500 };
  }

  const token = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : null;

  if (!token) {
    return { ok: false, error: 'Authentication required', status: 401 };
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(environmentId));

    const credentials = (payload as any).verified_credentials;
    const normalizedWallet = walletAddress.toLowerCase();
    const ownsWallet =
      Array.isArray(credentials) &&
      credentials.some(
        (credential: any) =>
          typeof credential?.address === 'string' &&
          credential.address.toLowerCase() === normalizedWallet
      );

    if (!ownsWallet) {
      return { ok: false, error: 'Wallet does not belong to the authenticated user', status: 403 };
    }

    return { ok: true };
  } catch (error) {
    console.error('Dynamic token verification failed:', error);
    return { ok: false, error: 'Invalid or expired authentication token', status: 401 };
  }
}
