import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { billingAccount, recordPurchase, mobileEntitlements, consumeMobileReport } from '../lib/store-billing/ledger';
import { getDb } from '../lib/db';
import type { VerifiedPurchase } from '../lib/store-billing/catalog';

test('durable billing ledger: idempotence, ownership, encryption, refunds and atomic credit consumption', { skip:process.env.BILLING_DB_TEST !== 'true' }, async () => {
  // Run only against an explicitly supplied isolated test database; never use the inherited deployment binding.
  assert.match(process.env.POSTGRES_DB || '', /^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\//);
  process.env.MOBILE_BILLING_ENABLED='true';
  process.env.MOBILE_BILLING_TOKEN_KEY=randomBytes(32).toString('base64');
  const wallet='0x'+randomBytes(20).toString('hex'), secondWallet='0x'+randomBytes(20).toString('hex');
  const account=await billingAccount(wallet), other=await billingAccount(secondWallet);
  const purchase:VerifiedPurchase={store:'google',purchaseId:randomBytes(32).toString('hex'),productId:'explorer_report_overview',kind:'consumable',reportType:'overview',accountId:account,proof:'sensitive-test-token',validUntil:null,revoked:false};
  try {
    assert.equal(await billingAccount(wallet.toUpperCase().replace('0X','0x')),account);
    await Promise.all(Array.from({length:5},()=>recordPurchase(purchase)));
    assert.equal((await mobileEntitlements(wallet,false)).availableReports.overview,1);
    const row=await getDb().query('SELECT proof FROM mobile_store_purchases WHERE account_id=$1',[account]);
    assert.notEqual(row.rows[0].proof,purchase.proof);
    await assert.rejects(recordPurchase({...purchase,accountId:other}),/another account/);
    const consumed=await Promise.all(Array.from({length:12},()=>consumeMobileReport(wallet,'overview')));
    assert.equal(consumed.filter(Boolean).length,1);
    // A replay after spending must not resurrect the credit.
    await recordPurchase(purchase);
    assert.equal((await mobileEntitlements(wallet,false)).availableReports.overview,0);
    await recordPurchase({...purchase,purchaseId:purchase.purchaseId+'refund',revoked:true});
    assert.equal((await mobileEntitlements(wallet,false)).availableReports.overview,0);
    const subscription:VerifiedPurchase={...purchase,purchaseId:'sub-'+purchase.purchaseId,productId:'explorer_premium_monthly',kind:'subscription',reportType:undefined,validUntil:new Date(Date.now()+3600000)};
    await recordPurchase(subscription);
    assert.equal((await mobileEntitlements(wallet,false)).isActive,true);
    await recordPurchase({...subscription,revoked:true});
    assert.equal((await mobileEntitlements(wallet,false)).isActive,false);
    await recordPurchase({...subscription,validUntil:new Date(Date.now()-1000),revoked:false});
    assert.equal((await mobileEntitlements(wallet,false)).isActive,false);
  } finally {
    await getDb().query('DELETE FROM mobile_store_purchases WHERE account_id=ANY($1::uuid[])',[[account,other]]);
    await getDb().query('DELETE FROM mobile_billing_accounts WHERE id=ANY($1::uuid[])',[[account,other]]);
    await getDb().end();
  }
});
