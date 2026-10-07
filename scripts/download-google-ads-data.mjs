#!/usr/bin/env node
/**
 * Downloads Google Ads campaign data for offline analysis.
 *
 * Setup:
 *   Fill GOOGLE_ADS_* values in scripts/ga-performance.env
 *   node scripts/download-google-ads-data.mjs
 *
 * Optional date overrides:
 *   GOOGLE_ADS_START_DATE=2026-06-27 GOOGLE_ADS_END_DATE=2026-06-29 node scripts/download-google-ads-data.mjs
 *
 * Output: /tmp/google-ads-data/<timestamp>/
 *   campaign_daily.json
 *   ad_group_daily.json
 *   keyword_daily.json
 *   search_terms.json
 *   campaign_summary.json
 *   index.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v24';

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

function normalizeCustomerId(value) {
  return (value || '').replace(/\D/g, '');
}

function isoDateNDaysAgo(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function getAccessToken(env) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth refresh failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.access_token;
}

function flattenGoogleAdsRow(row) {
  const out = {};

  function visit(value, prefix) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      out[prefix] = value.join(',');
      return;
    }
    if (typeof value !== 'object') {
      out[prefix] = value;
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, prefix ? `${prefix}.${key}` : key);
    }
  }

  visit(row, '');
  return out;
}

async function googleAdsSearchStream(env, accessToken, query) {
  const customerId = normalizeCustomerId(env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = normalizeCustomerId(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': developerToken,
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const response = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google Ads query failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.flatMap(chunk => chunk.results || []).map(flattenGoogleAdsRow);
}

function assertGoogleAdsEnv(env) {
  const required = [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
  ];

  const missing = required.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing Google Ads env values: ${missing.join(', ')}`);
  }
}

async function main() {
  const envPath = join(__dirname, 'ga-performance.env');
  const env = loadEnv(envPath);
  assertGoogleAdsEnv(env);

  const lookbackDays = Number(env.GOOGLE_ADS_LOOKBACK_DAYS || 30);
  const startDate = env.GOOGLE_ADS_START_DATE || isoDateNDaysAgo(lookbackDays);
  const endDate = env.GOOGLE_ADS_END_DATE || isoDateNDaysAgo(0);
  const dateClause = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;

  console.log(`Authenticating Google Ads API for customer ${normalizeCustomerId(env.GOOGLE_ADS_CUSTOMER_ID)}...`);
  const accessToken = await getAccessToken(env);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join('/tmp', 'google-ads-data', ts);
  mkdirSync(outDir, { recursive: true });
  console.log(`Output directory: ${outDir}`);

  const reports = [
    {
      name: 'campaign_daily',
      label: 'campaign daily metrics',
      query: `
        SELECT
          segments.date,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.ctr,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign
        WHERE ${dateClause}
        ORDER BY segments.date, metrics.clicks DESC
      `,
    },
    {
      name: 'ad_group_daily',
      label: 'ad group daily metrics',
      query: `
        SELECT
          segments.date,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          ad_group.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.ctr,
          metrics.conversions
        FROM ad_group
        WHERE ${dateClause}
        ORDER BY segments.date, metrics.clicks DESC
      `,
    },
    {
      name: 'keyword_daily',
      label: 'keyword daily metrics',
      query: `
        SELECT
          segments.date,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          ad_group_criterion.criterion_id,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.ctr,
          metrics.conversions
        FROM keyword_view
        WHERE ${dateClause}
          AND ad_group_criterion.type = KEYWORD
        ORDER BY segments.date, metrics.clicks DESC
      `,
    },
    {
      name: 'search_terms',
      label: 'search terms',
      query: `
        SELECT
          segments.date,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          search_term_view.search_term,
          search_term_view.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.ctr,
          metrics.conversions
        FROM search_term_view
        WHERE ${dateClause}
        ORDER BY metrics.clicks DESC
      `,
    },
    {
      name: 'campaign_summary',
      label: 'campaign summary metrics',
      query: `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.optimization_score,
          campaign_budget.amount_micros,
          campaign_budget.delivery_method,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.average_cpc,
          metrics.ctr,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign
        WHERE ${dateClause}
        ORDER BY metrics.clicks DESC
      `,
    },
  ];

  const files = [];
  for (const report of reports) {
    process.stdout.write(`  Fetching ${report.label}...`);
    try {
      const rows = await googleAdsSearchStream(env, accessToken, report.query);
      const file = `${report.name}.json`;
      writeFileSync(
        join(outDir, file),
        JSON.stringify({ meta: { report: report.name, startDate, endDate, rowCount: rows.length }, rows }, null, 2)
      );
      files.push({ file, rowCount: rows.length, label: report.label });
      console.log(` ${rows.length} rows`);
    } catch (err) {
      const file = `${report.name}.json`;
      files.push({ file, error: err.message, label: report.label });
      console.log(` FAILED: ${err.message}`);
    }
  }

  const index = {
    downloadedAt: new Date().toISOString(),
    apiVersion: API_VERSION,
    customerId: normalizeCustomerId(env.GOOGLE_ADS_CUSTOMER_ID),
    loginCustomerId: normalizeCustomerId(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
    startDate,
    endDate,
    files,
  };
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`\nDone. ${files.filter(file => !file.error).length}/${files.length} reports saved to:`);
  console.log(`  ${outDir}`);
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
