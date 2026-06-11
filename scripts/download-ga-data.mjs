#!/usr/bin/env node
/**
 * Downloads GA4 data for the configured period to a timestamped folder for offline analysis.
 *
 * Setup:
 *   cp scripts/ga-performance.env.example scripts/ga-performance.env
 *   node scripts/download-ga-data.mjs
 *
 * Output: /tmp/ga-data/<timestamp>/
 *   overview.json        - session/user/engagement summary
 *   events.json          - all app event counts
 *   events_by_date.json  - daily event time series
 *   pages.json           - page views by path
 *   acquisition.json     - sessions by source / medium
 *   devices.json         - sessions by device category
 *   countries.json       - sessions by country
 *   onboarding_paths.json - onboarding_path_chosen breakdown
 *   onboarding_steps.json - onboarding_step_viewed by step name and number
 *   index.json           - metadata about this download
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { createSign } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function resolveServiceAccount(env) {
  if (env.GA_SERVICE_ACCOUNT_JSON) return JSON.parse(env.GA_SERVICE_ACCOUNT_JSON);
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (env.GA_CLIENT_EMAIL && env.GA_PRIVATE_KEY) {
    return { client_email: env.GA_CLIENT_EMAIL, private_key: env.GA_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  throw new Error('No Google service account credentials found. See ga-performance.env.example.');
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken(clientEmail, privateKey) {
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
  const jwt = `${payload}.${b64url(signer.sign(privateKey))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function ga4Report(propertyId, token, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA4 error (${res.status}): ${await res.text()}`);
  return res.json();
}

const APP_EVENTS = [
  'terms_accepted', 'onboarding_started', 'onboarding_completed', 'onboarding_dismissed',
  'onboarding_path_chosen', 'get_started_clicked', 'onboarding_action',
  'explore_tab_viewed', 'query_run', 'match_revealed',
  'genotype_file_upload_started', 'genotype_file_upload_failed', 'genotype_file_loaded',
  'genotype_file_cleared',
  'sample_data_started', 'sample_data_loaded', 'sample_data_failed',
  'ai_analysis_run', 'ai_consent_given', 'ai_consent_declined', 'ai_consent_modal_shown',
  'llm_question_asked', 'example_question_clicked',
  'overview_report_generated', 'overview_report_viewed', 'overview_report_tab_viewed', 'ai_provider_switched',
  'intro_modal_shown', 'dna_chat_viewed', 'dna_chat_sample_data_loaded', 'dna_chat_sample_data_failed',
  'run_all_started', 'run_all_completed', 'run_all_failed',
  'premium_section_viewed', 'premium_tab_viewed',
  'subscribe_page_viewed', 'payment_method_selected',
  'checkout_started', 'checkout_submitted', 'checkout_failed',
  'subscribed_credit_card', 'subscribed_stablecoin', 'subscribed_promo_code',
  'stripe_promo_code_applied', 'subscription_confirmation_viewed',
  'user_logged_in', 'user_logged_out', 'sign_in_started',
  'search_mode_changed', 'study_analysis_started',
  'results_file_saved', 'results_file_loaded',
  'tour_started', 'tour_step_viewed', 'tour_completed', 'tour_dismissed',
  'personalization_updated',
  'session_start', 'page_view', 'first_visit',
];

function flattenReport(report) {
  if (!report.rows?.length) return [];
  const dimHeaders = (report.dimensionHeaders || []).map(h => h.name);
  const metHeaders = (report.metricHeaders || []).map(h => h.name);
  return report.rows.map(row => {
    const obj = {};
    dimHeaders.forEach((h, i) => { obj[h] = row.dimensionValues[i].value; });
    metHeaders.forEach((h, i) => { obj[h] = row.metricValues[i].value; });
    return obj;
  });
}

async function fetchOverview(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'activeUsers' },
      { name: 'sessions' }, { name: 'bounceRate' }, { name: 'averageSessionDuration' },
      { name: 'screenPageViews' }, { name: 'engagedSessions' },
      { name: 'engagementRate' }, { name: 'sessionsPerUser' },
    ],
    limit: 1,
  });
}

async function fetchEvents(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', inListFilter: { values: APP_EVENTS } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 200,
  });
}

async function fetchEventsByDate(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', inListFilter: { values: APP_EVENTS } },
    },
    orderBys: [{ dimension: { dimensionName: 'date' } }, { metric: { metricName: 'eventCount' }, desc: true }],
    limit: 500,
  });
}

async function fetchPages(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'averageSessionDuration' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 50,
  });
}

async function fetchAcquisition(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 50,
  });
}

async function fetchDevices(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'bounceRate' }, { name: 'engagementRate' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });
}

async function fetchCountries(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'country' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 30,
  });
}

async function fetchOnboardingSteps(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'customEvent:step' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'onboarding_step_viewed' } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 100,
  });
}

async function fetchPaidFunnel(propertyId, token, startDate, endDate) {
  const FUNNEL_EVENTS = [
    'intro_modal_shown', 'get_started_clicked', 'dna_chat_viewed',
    'dna_chat_sample_data_loaded', 'dna_chat_sample_data_failed',
    'ai_consent_modal_shown', 'ai_consent_given', 'ai_consent_declined',
    'example_question_clicked', 'llm_question_asked',
    'genotype_file_upload_started', 'genotype_file_loaded',
  ];
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: 'eventName', inListFilter: { values: FUNNEL_EVENTS } } },
          { filter: { fieldName: 'sessionDefaultChannelGrouping', stringFilter: { matchType: 'EXACT', value: 'Paid Search' } } },
        ],
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 100,
  });
}

async function fetchEngagementByChannel(propertyId, token, startDate, endDate) {
  const ENGAGEMENT_EVENTS = [
    'llm_question_asked', 'example_question_clicked',
    'dna_chat_sample_data_loaded', 'ai_consent_given',
    'genotype_file_loaded', 'run_all_completed', 'results_file_saved',
  ];
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionSource' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', inListFilter: { values: ENGAGEMENT_EVENTS } },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 200,
  });
}

async function fetchOnboardingPaths(propertyId, token, startDate, endDate) {
  return ga4Report(propertyId, token, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: {
          values: [
            'onboarding_started', 'onboarding_completed', 'onboarding_dismissed',
            'onboarding_path_chosen', 'onboarding_step_viewed', 'onboarding_action',
            'get_started_clicked', 'sample_data_started', 'sample_data_loaded',
          ],
        },
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 50,
  });
}

async function main() {
  const envPath = join(__dirname, 'ga-performance.env');
  console.log(`Reading config: ${envPath}`);
  const env = loadEnv(envPath);

  const propertyId = env.GA4_PROPERTY_ID;
  if (!propertyId || propertyId === '123456789') {
    throw new Error('Set GA4_PROPERTY_ID in scripts/ga-performance.env to your numeric GA4 property ID.');
  }

  const lookbackDays = parseInt(env.GA_LOOKBACK_DAYS || '1', 10);
  const endDate = env.GA_END_DATE || 'today';
  const startDate = env.GA_START_DATE || `${lookbackDays}daysAgo`;
  const periodLabel = `${startDate} to ${endDate}`;

  const sa = resolveServiceAccount(env);
  const privateKey = (sa.private_key || '').replace(/\\n/g, '\n');
  const clientEmail = sa.client_email;
  if (!clientEmail || !privateKey) throw new Error('Service account is missing client_email or private_key.');

  console.log(`Authenticating (${clientEmail})...`);
  const token = await getAccessToken(clientEmail, privateKey);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join('/tmp', 'ga-data', ts);
  mkdirSync(outDir, { recursive: true });
  console.log(`Output directory: ${outDir}`);

  const reports = [
    { name: 'overview',              label: 'overview metrics',            fn: fetchOverview },
    { name: 'events',                label: 'event counts',                fn: fetchEvents },
    { name: 'events_by_date',        label: 'events by date',              fn: fetchEventsByDate },
    { name: 'pages',                 label: 'page views',                  fn: fetchPages },
    { name: 'acquisition',           label: 'traffic acquisition',         fn: fetchAcquisition },
    { name: 'devices',               label: 'device breakdown',            fn: fetchDevices },
    { name: 'countries',             label: 'country breakdown',           fn: fetchCountries },
    { name: 'onboarding_paths',      label: 'onboarding path breakdown',   fn: fetchOnboardingPaths },
    { name: 'onboarding_steps',      label: 'onboarding step breakdown',   fn: fetchOnboardingSteps },
    { name: 'paid_funnel',           label: 'paid traffic funnel',         fn: fetchPaidFunnel },
    { name: 'engagement_by_channel', label: 'engagement events by channel',fn: fetchEngagementByChannel },
  ];

  const downloaded = [];

  for (const report of reports) {
    process.stdout.write(`  Fetching ${report.label}...`);
    try {
      const raw = await report.fn(propertyId, token, startDate, endDate);
      const rows = flattenReport(raw);
      const file = `${report.name}.json`;
      writeFileSync(
        join(outDir, file),
        JSON.stringify({ meta: { report: report.name, startDate, endDate, rowCount: rows.length }, rows }, null, 2)
      );
      downloaded.push({ file, rowCount: rows.length, label: report.label });
      console.log(` ${rows.length} rows`);
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
      downloaded.push({ file: `${report.name}.json`, error: err.message, label: report.label });
    }
  }

  const index = {
    downloadedAt: new Date().toISOString(),
    propertyId,
    periodLabel,
    startDate,
    endDate,
    lookbackDays,
    files: downloaded,
  };
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`\nDone. ${downloaded.filter(d => !d.error).length}/${downloaded.length} reports saved to:`);
  console.log(`  ${outDir}`);
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
