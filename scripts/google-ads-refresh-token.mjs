#!/usr/bin/env node
/**
 * Generates GOOGLE_ADS_REFRESH_TOKEN for local Google Ads API scripts.
 *
 * Run:
 *   node scripts/google-ads-refresh-token.mjs
 *
 * The script starts a temporary localhost callback server, prints a Google
 * consent URL, and writes the refresh token back to scripts/ga-performance.env.
 */

import { createServer } from 'http';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, 'ga-performance.env');
const SCOPE = 'https://www.googleapis.com/auth/adwords';
const PORT = Number(process.env.GOOGLE_ADS_OAUTH_PORT || 53682);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

function loadEnv(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(`Env file not found: ${envPath}`);
  }

  const env = {};
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return { ...env, ...process.env };
}

function updateEnvValue(envPath, key, value) {
  const text = readFileSync(envPath, 'utf8');
  const escapedValue = value.replace(/\n/g, '\\n');
  const line = `${key}=${escapedValue}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(text)) {
    writeFileSync(envPath, text.replace(pattern, line));
    return;
  }

  writeFileSync(envPath, `${text.trimEnd()}\n${line}\n`);
}

async function exchangeCodeForRefreshToken({ clientId, clientSecret, code }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(body)}`);
  }

  if (!body.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke the OAuth client grant for this user, then rerun with prompt=consent.'
    );
  }

  return body.refresh_token;
}

function waitForOAuthCallback({ clientId, clientSecret, state }) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', REDIRECT_URI);
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          throw new Error(`OAuth failed: ${error}`);
        }
        if (!code) {
          throw new Error('OAuth callback did not include a code.');
        }
        if (returnedState !== state) {
          throw new Error('OAuth state mismatch.');
        }

        const refreshToken = await exchangeCodeForRefreshToken({ clientId, clientSecret, code });
        updateEnvValue(ENV_PATH, 'GOOGLE_ADS_REFRESH_TOKEN', refreshToken);

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Google Ads refresh token saved. You can close this tab.');
        server.close();
        resolve(refreshToken);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(err instanceof Error ? err.message : String(err));
        server.close();
        reject(err);
      }
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1');
  });
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const clientId = env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in scripts/ga-performance.env first.');
  }

  const state = randomBytes(16).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  console.log(`Listening for OAuth callback at ${REDIRECT_URI}`);
  console.log('\nOpen this URL in your browser, then approve access:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for callback...');

  await waitForOAuthCallback({ clientId, clientSecret, state });
  console.log('\nGOOGLE_ADS_REFRESH_TOKEN saved to scripts/ga-performance.env');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
