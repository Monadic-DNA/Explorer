import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { productFor } from '../lib/store-billing/catalog';
import { normalizeApple, normalizeGoogle, assertStoreConfigured } from '../lib/store-billing/verification';

const account = 'c23d2d00-1b82-43fc-af3f-5be522e3dccf';
const subscription='explorer_premium_monthly', report='explorer_report_overview';
const apple = { transactionId:'123',originalTransactionId:'120',productId:subscription,bundleId:'com.monadicdna.explorer',environment:'Production',appAccountToken:account,quantity:1,type:'Auto-Renewable Subscription',expiresDate:Date.now()+86400000 };
const play = { externalAccountIdentifiers:{obfuscatedExternalAccountId:account}, subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',lineItems:[{productId:subscription,expiryTime:new Date(Date.now()+86400000).toISOString()}] };

test('allowlisted catalog rejects arbitrary paid features', () => {
  assert.equal(productFor(report).reportType,'overview');
  assert.throws(() => productFor('attacker_product'));
});
test('Apple account/app/environment/product type are independently bound', () => {
  const valid=normalizeApple(apple,account,'123','Production');
  assert.equal(valid.purchaseId,'120');
  assert.equal(valid.kind,'subscription');
  for(const update of [{appAccountToken:'another-account'},{bundleId:'another.app'},{environment:'Sandbox'},{quantity:2},{type:'Consumable'}]) {
    assert.throws(() => normalizeApple({...apple,...update},account,'123','Production'));
  }
  assert.equal(normalizeApple({...apple,revocationDate:Date.now()},account,'123','Production').revoked,true);
});
test('Apple consumable uses transaction ID, not subscription-chain identity', () => {
  const result=normalizeApple({...apple,productId:report,type:'Consumable'},account,'123','Production');
  assert.equal(result.purchaseId,'123');assert.equal(result.reportType,'overview');
});
test('Apple verifier rejects unsigned/fabricated purchase assertions', async () => {
  const verifier = new SignedDataVerifier([readFileSync('certs/apple/AppleRootCA-G3.cer')],false,Environment.SANDBOX,'com.monadicdna.explorer');
  const jwt = [Buffer.from(JSON.stringify({alg:'none'})).toString('base64url'),Buffer.from(JSON.stringify(apple)).toString('base64url'),''].join('.');
  await assert.rejects(verifier.verifyAndDecodeTransaction(jwt));
});
test('Play binds account and SKU and excludes test purchases in production', () => {
  assert.equal(normalizeGoogle(play,subscription,account,'token').revoked,false);
  assert.throws(() => normalizeGoogle(play,subscription,'other','token'));
  assert.throws(() => normalizeGoogle({...play,lineItems:[{productId:report}]},subscription,account,'token'));
  assert.throws(() => normalizeGoogle({...play,testPurchase:{}},subscription,account,'token'));
  assert.equal(normalizeGoogle({...play,testPurchase:{}},subscription,account,'token',true).revoked,false);
});
test('Play expiry survives cancellation, while pending, paused, on-hold and expired states grant no access', () => {
  assert.equal(normalizeGoogle({...play,subscriptionState:'SUBSCRIPTION_STATE_CANCELED'},subscription,account,'token').revoked,false);
  for(const state of ['SUBSCRIPTION_STATE_PENDING','SUBSCRIPTION_STATE_PAUSED','SUBSCRIPTION_STATE_ON_HOLD','SUBSCRIPTION_STATE_EXPIRED']) {
    assert.equal(normalizeGoogle({...play,subscriptionState:state},subscription,account,'token').revoked,true);
  }
  assert.throws(() => normalizeGoogle({...play,lineItems:[{productId:subscription,expiryTime:'invalid'}]},subscription,account,'token'));
});
test('Play report refunds and pending payments cannot grant credits; multi-quantity purchases are rejected', () => {
  const paid={obfuscatedExternalAccountId:account,purchaseState:0,quantity:1};
  assert.equal(normalizeGoogle(paid,report,account,'token').revoked,false);
  assert.equal(normalizeGoogle({...paid,purchaseState:1},report,account,'token').revoked,true);
  assert.equal(normalizeGoogle({...paid,purchaseState:2},report,account,'token').revoked,true);
  assert.throws(() => normalizeGoogle({...paid,quantity:2},report,account,'token'));
});

test('purchase preflight rejects missing configuration and accepts an escaped PEM key', () => {
  const names=['APPLE_IAP_PRIVATE_KEY','APPLE_IAP_ISSUER_ID','APPLE_IAP_KEY_ID','APPLE_APP_ID','APPLE_STORE_ENVIRONMENT'];
  const previous=Object.fromEntries(names.map(name => [name,process.env[name]]));
  try {
    for(const name of names) delete process.env[name];
    assert.throws(() => assertStoreConfigured('apple'));
    const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    process.env.APPLE_IAP_PRIVATE_KEY=String(privateKey.export({type:'pkcs8',format:'pem'})).split(String.fromCharCode(10)).join(String.fromCharCode(92)+'n');
    process.env.APPLE_IAP_ISSUER_ID='test-issuer';process.env.APPLE_IAP_KEY_ID='TESTKEY';process.env.APPLE_APP_ID='123456';
    assert.doesNotThrow(() => assertStoreConfigured('apple'));
  } finally {
    for(const name of names) { if(previous[name]===undefined) delete process.env[name]; else process.env[name]=previous[name]; }
  }
});
