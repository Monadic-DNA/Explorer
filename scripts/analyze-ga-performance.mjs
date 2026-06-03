#!/usr/bin/env node
/**
 * Fetches GA4 event data for the past day and runs a local LLM analysis via Ollama.
 *
 * Setup:
 *   cp scripts/ga-performance.env.example scripts/ga-performance.env
 *   # Fill in GA4_PROPERTY_ID and a service account credential option
 *   node scripts/analyze-ga-performance.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { createSign } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Env file parser
// ---------------------------------------------------------------------------

function loadEnv(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(
      `Env file not found: ${envPath}\n` +
      `Copy scripts/ga-performance.env.example to scripts/ga-performance.env and fill in the values.`
    );
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
  return env;
}

// ---------------------------------------------------------------------------
// Service account resolution
// ---------------------------------------------------------------------------

function resolveServiceAccount(env) {
  if (env.GA_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(env.GA_SERVICE_ACCOUNT_JSON);
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  if (env.GA_CLIENT_EMAIL && env.GA_PRIVATE_KEY) {
    return {
      client_email: env.GA_CLIENT_EMAIL,
      private_key: env.GA_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  throw new Error(
    'No Google service account credentials found. ' +
    'Set GA_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or GA_CLIENT_EMAIL + GA_PRIVATE_KEY.'
  );
}

// ---------------------------------------------------------------------------
// Google service account JWT auth
// ---------------------------------------------------------------------------

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeServiceAccountJWT(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(Buffer.from(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));
  const payload = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  return `${payload}.${b64url(signer.sign(privateKey))}`;
}

async function getAccessToken(clientEmail, privateKey) {
  const jwt = makeServiceAccountJWT(clientEmail, privateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

// ---------------------------------------------------------------------------
// GA4 Data API queries
// ---------------------------------------------------------------------------

async function ga4Post(propertyId, accessToken, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA4 API error (${res.status}): ${await res.text()}`);
  return res.json();
}

// All events defined in lib/analytics.ts
const APP_EVENTS = [
  'terms_accepted',
  'onboarding_started',
  'onboarding_completed',
  'onboarding_dismissed',
  'onboarding_path_chosen',
  'explore_tab_viewed',
  'query_run',
  'match_revealed',
  'genotype_file_upload_started',
  'genotype_file_upload_failed',
  'genotype_file_loaded',
  'ai_analysis_run',
  'ai_consent_given',
  'ai_consent_declined',
  'llm_question_asked',
  'overview_report_generated',
  'run_all_started',
  'run_all_completed',
  'run_all_failed',
  'premium_section_viewed',
  'premium_tab_viewed',
  'subscribe_page_viewed',
  'checkout_started',
  'checkout_submitted',
  'checkout_failed',
  'subscribed_credit_card',
  'subscribed_stablecoin',
  'subscribed_promo_code',
  'user_logged_in',
  'sign_in_started',
  'results_file_saved',
  'results_file_loaded',
  'ai_provider_switched',
  'sample_data_started',
  'sample_data_loaded',
  'tour_started',
  'tour_completed',
  'tour_dismissed',
  'get_started_clicked',
  'personalization_updated',
  'session_start',
  'page_view',
];

async function fetchEventCounts(propertyId, accessToken, startDate, endDate) {
  return ga4Post(propertyId, accessToken, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: APP_EVENTS },
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 100,
  });
}

async function fetchSessionMetrics(propertyId, accessToken, startDate, endDate) {
  return ga4Post(propertyId, accessToken, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'sessions' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'screenPageViews' },
    ],
    limit: 1,
  });
}

// ---------------------------------------------------------------------------
// Data formatting
// ---------------------------------------------------------------------------

function formatSessionMetrics(report) {
  if (!report.rows?.length) return 'No session data available.';
  const row = report.rows[0];
  return report.metricHeaders.map((h, i) => {
    const val = row.metricValues[i].value;
    if (h.name === 'bounceRate') return `bounceRate: ${(parseFloat(val) * 100).toFixed(1)}%`;
    if (h.name === 'averageSessionDuration') {
      const secs = Math.round(parseFloat(val));
      return `averageSessionDuration: ${Math.floor(secs / 60)}m ${secs % 60}s`;
    }
    return `${h.name}: ${val}`;
  }).join('\n');
}

function formatEventTable(report) {
  if (!report.rows?.length) return '(no custom events fired in this period)';
  return report.rows
    .map(r => `${r.dimensionValues[0].value.padEnd(40)} ${r.metricValues[0].value}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function queryOllama(baseUrl, model, prompt) {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error (${res.status}): ${await res.text()}`);
  return (await res.json()).response;
}

// ---------------------------------------------------------------------------
// Analysis prompt
// ---------------------------------------------------------------------------

function buildPrompt(periodLabel, sessionBlock, eventBlock) {
  return `You are analyzing performance data for "Monadic DNA Explorer" (codenamed GWASifier), a Next.js web app where users upload their personal DNA files (23andMe, AncestryDNA) and match them against GWAS (Genome-Wide Association Studies) research using AI analysis. Paid features cost $4.99/month.

Core user journey:
  1. Landing / terms_accepted
  2. Onboarding: onboarding_started -> onboarding_completed (or onboarding_dismissed)
  3. Explore studies: explore_tab_viewed, query_run
  4. Upload DNA: genotype_file_upload_started -> genotype_file_loaded (failure: genotype_file_upload_failed)
  5. Analyze matches: match_revealed, run_all_started -> run_all_completed
  6. AI features (premium): ai_analysis_run, llm_question_asked, overview_report_generated
  7. Subscribe: subscribe_page_viewed -> checkout_started -> subscribed_credit_card / subscribed_stablecoin

Key conversion funnels to evaluate:
  - Onboarding: onboarding_started -> onboarding_completed
  - DNA upload success: genotype_file_loaded / genotype_file_upload_started
  - AI engagement: ai_consent_given / match_revealed
  - Premium conversion: subscribed_* / subscribe_page_viewed

SESSION METRICS (${periodLabel}):
${sessionBlock}

EVENT COUNTS (${periodLabel}):
${eventBlock}

Analyze the above data and provide:
1. Traffic summary (users, sessions, engagement quality)
2. Onboarding funnel with completion rate
3. Core feature usage (DNA upload, study exploration, AI analysis)
4. Premium and subscription funnel (if any activity)
5. What is working well, and what looks like it needs attention
6. Any anomalies or patterns worth flagging

Use the numbers directly. If an event count is zero or missing, note it explicitly. Keep the analysis focused and actionable.`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const envPath = join(__dirname, 'ga-performance.env');
  console.log(`Reading config: ${envPath}`);
  const env = loadEnv(envPath);

  const propertyId = env.GA4_PROPERTY_ID;
  if (!propertyId || propertyId === '123456789') {
    throw new Error('Set GA4_PROPERTY_ID in scripts/ga-performance.env to your numeric GA4 property ID.');
  }

  const lookbackDays = parseInt(env.GA_LOOKBACK_DAYS || '1', 10);
  const ollamaBaseUrl = (env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  const ollamaModel = env.OLLAMA_MODEL || 'gemma4';

  const periodLabel = lookbackDays === 1 ? 'the past day' : `the past ${lookbackDays} days`;
  const endDate = 'today';
  const startDate = `${lookbackDays}daysAgo`;

  const sa = resolveServiceAccount(env);
  const privateKey = (sa.private_key || '').replace(/\\n/g, '\n');
  const clientEmail = sa.client_email;
  if (!clientEmail || !privateKey) {
    throw new Error('Service account is missing client_email or private_key.');
  }

  console.log(`Authenticating with Google (${clientEmail})...`);
  const accessToken = await getAccessToken(clientEmail, privateKey);

  console.log(`Querying GA4 property ${propertyId} for ${periodLabel}...`);
  const [eventReport, sessionReport] = await Promise.all([
    fetchEventCounts(propertyId, accessToken, startDate, endDate),
    fetchSessionMetrics(propertyId, accessToken, startDate, endDate),
  ]);

  const sessionBlock = formatSessionMetrics(sessionReport);
  const eventBlock = formatEventTable(eventReport);

  console.log('\n--- Session Metrics ---');
  console.log(sessionBlock);
  console.log('\n--- Event Counts ---');
  console.log(eventBlock);

  console.log(`\nSending to Ollama (${ollamaModel})...`);
  const analysis = await queryOllama(ollamaBaseUrl, ollamaModel, buildPrompt(periodLabel, sessionBlock, eventBlock));

  console.log('\n=== Performance Analysis ===');
  console.log(`Period: ${periodLabel}  |  Property: ${propertyId}  |  Model: ${ollamaModel}\n`);
  console.log(analysis);
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
