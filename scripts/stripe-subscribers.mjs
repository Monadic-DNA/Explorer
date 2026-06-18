#!/usr/bin/env node
/**
 * Fetches subscriber data from Stripe: active and cancelled subscriptions,
 * tenure, and total spend per customer.
 *
 * Setup:
 *   Add STRIPE_SECRET_KEY=sk_live_... to scripts/ga-performance.env
 *   node scripts/stripe-subscribers.mjs
 *
 * Output: summary printed to stdout, full data written to /tmp/stripe-subscribers-<timestamp>.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(envPath) {
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

async function stripeGet(path, secretKey, params = {}, expand = []) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (const e of expand) url.searchParams.append('expand[]', e);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function paginate(path, secretKey, params = {}, expand = []) {
  const items = [];
  let startingAfter = null;
  while (true) {
    const p = { limit: '100', ...params };
    if (startingAfter) p.starting_after = startingAfter;
    const page = await stripeGet(path, secretKey, p, expand);
    items.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return items;
}

function formatDate(ts) {
  if (!ts) return 'n/a';
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function tenureDays(createdTs, endedTs) {
  const end = endedTs ? endedTs * 1000 : Date.now();
  return Math.round((end - createdTs * 1000) / (1000 * 60 * 60 * 24));
}

async function main() {
  const envPath = join(__dirname, 'ga-performance.env');
  const env = loadEnv(envPath);

  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.startsWith('sk_test_placeholder')) {
    throw new Error('Add STRIPE_SECRET_KEY=sk_live_... to scripts/ga-performance.env');
  }

  console.log('Fetching subscriptions...');
  const [activeSubs, cancelledSubs] = await Promise.all([
    paginate('subscriptions', secretKey, { status: 'active' }, ['data.customer']),
    paginate('subscriptions', secretKey, { status: 'canceled' }, ['data.customer']),
  ]);

  console.log(`  Active: ${activeSubs.length}, Cancelled: ${cancelledSubs.length}`);
  console.log('Fetching invoices...');

  // Collect all customer IDs
  const allSubs = [...activeSubs, ...cancelledSubs];
  const customerIds = [...new Set(allSubs.map(s =>
    typeof s.customer === 'string' ? s.customer : s.customer?.id
  ).filter(Boolean))];

  // Fetch paid invoices per customer
  console.log(`  Fetching invoices for ${customerIds.length} customers...`);
  const spendByCustomer = {};
  for (const customerId of customerIds) {
    const invoices = await paginate('invoices', secretKey, {
      customer: customerId,
      status: 'paid',
    });
    spendByCustomer[customerId] = invoices.reduce((sum, inv) => sum + inv.amount_paid, 0);
  }

  // Build subscriber records
  const records = allSubs.map(sub => {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const customerEmail = typeof sub.customer === 'object' ? sub.customer?.email : null;
    const tenure = tenureDays(sub.created, sub.ended_at);
    const totalSpendCents = spendByCustomer[customerId] || 0;

    return {
      subscriptionId: sub.id,
      customerId,
      customerEmail,
      status: sub.status,
      created: formatDate(sub.created),
      cancelledAt: formatDate(sub.canceled_at),
      endedAt: formatDate(sub.ended_at),
      tenureDays: tenure,
      tenureMonths: (tenure / 30).toFixed(1),
      totalSpendUsd: (totalSpendCents / 100).toFixed(2),
    };
  });

  records.sort((a, b) => new Date(b.created) - new Date(a.created));

  // Summary stats
  const active = records.filter(r => r.status === 'active');
  const cancelled = records.filter(r => r.status !== 'active');
  const allSpend = records.map(r => parseFloat(r.totalSpendUsd));
  const cancelledTenures = cancelled.map(r => r.tenureDays);

  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  console.log('\n--- Summary ---');
  console.log(`Active subscribers:    ${active.length}`);
  console.log(`Cancelled subscribers: ${cancelled.length}`);
  console.log(`Total revenue:         $${allSpend.reduce((a, b) => a + b, 0).toFixed(2)}`);
  console.log(`Avg spend per customer: $${avg(allSpend).toFixed(2)}`);
  if (cancelledTenures.length) {
    console.log(`Avg tenure (cancelled): ${avg(cancelledTenures).toFixed(0)} days (${(avg(cancelledTenures) / 30).toFixed(1)} months)`);
  }
  if (active.length) {
    const activeTenures = active.map(r => r.tenureDays);
    console.log(`Avg tenure (active):    ${avg(activeTenures).toFixed(0)} days (${(avg(activeTenures) / 30).toFixed(1)} months)`);
  }

  console.log('\n--- Subscribers ---');
  for (const r of records) {
    const label = r.status === 'active' ? '[active]   ' : '[cancelled]';
    console.log(`${label} ${r.created}  tenure: ${r.tenureMonths}mo  spend: $${r.totalSpendUsd}  ${r.customerEmail || r.customerId}`);
  }

  // Write JSON output
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = `/tmp/stripe-subscribers-${ts}.json`;
  writeFileSync(outPath, JSON.stringify({ summary: { active: active.length, cancelled: cancelled.length }, records }, null, 2));
  console.log(`\nFull data written to: ${outPath}`);
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
