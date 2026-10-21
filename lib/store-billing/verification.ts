import { readFileSync } from 'node:fs';
import { createHash, createPrivateKey } from 'node:crypto';
import path from 'node:path';
import { AppStoreServerAPIClient, Environment, SignedDataVerifier, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library';
import { GoogleAuth } from 'google-auth-library';
import { BillingError, productFor, required, type Store, type VerifiedPurchase } from './catalog';

const bundleId = 'com.monadicdna.explorer';
export function appleServices() {
  const environment = process.env.APPLE_STORE_ENVIRONMENT === 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;
  const appId = environment === Environment.PRODUCTION ? Number(required('APPLE_APP_ID')) : undefined;
  if (appId !== undefined && (!Number.isSafeInteger(appId) || appId <= 0)) throw new BillingError('Invalid Apple app configuration', 503);
  const verifier = new SignedDataVerifier([readFileSync(path.join(process.cwd(), 'certs/apple/AppleRootCA-G3.cer'))], true, environment, bundleId, appId);
  const client = new AppStoreServerAPIClient(required('APPLE_IAP_PRIVATE_KEY').replace(/\\n/g, '\n'), required('APPLE_IAP_KEY_ID'), required('APPLE_IAP_ISSUER_ID'), bundleId, environment);
  return { verifier, client, environment };
}

export function normalizeApple(tx: JWSTransactionDecodedPayload, accountId: string, proof: string, environment: string): VerifiedPurchase {
  const product = productFor(tx.productId || '');
  if (tx.bundleId !== bundleId || tx.environment !== environment || tx.appAccountToken?.toLowerCase() !== accountId.toLowerCase()) throw new BillingError('Purchase does not belong to this app/account', 403);
  if (!tx.transactionId || !tx.originalTransactionId || tx.quantity !== 1) throw new BillingError('Invalid purchase');
  const type = product.kind === 'subscription' ? 'Auto-Renewable Subscription' : 'Consumable';
  if (tx.type !== type) throw new BillingError('Incorrect store product type');
  const expiry = product.kind === 'subscription' ? new Date(tx.expiresDate || 0) : null;
  if (expiry && !Number.isFinite(expiry.getTime())) throw new BillingError('Invalid expiry');
  return { store:'apple', purchaseId:product.kind === 'subscription' ? tx.originalTransactionId : tx.transactionId, accountId, productId:product.id, kind:product.kind, reportType:product.reportType, validUntil:expiry, revoked:tx.revocationDate !== undefined, proof };
}

async function verifyApple(proof: string, productId: string, accountId: string) {
  if (!/^\d{1,30}$/.test(proof)) throw new BillingError('Invalid Apple transaction ID');
  const { client, verifier, environment } = appleServices();
  const response = await client.getTransactionInfo(proof);
  const tx = await verifier.verifyAndDecodeTransaction(response.signedTransactionInfo || '');
  if (tx.transactionId !== proof || tx.productId !== productId) throw new BillingError('Transaction/product mismatch');
  let purchase = normalizeApple(tx, accountId, proof, environment);
  if (purchase.kind === 'subscription') {
    const status = await client.getAllSubscriptionStatuses(proof);
    const latest = status.data?.flatMap(group => group.lastTransactions || []).find(item => item.originalTransactionId === tx.originalTransactionId);
    if (!latest?.signedTransactionInfo) throw new BillingError('Subscription status unavailable', 503);
    const current = await verifier.verifyAndDecodeTransaction(latest.signedTransactionInfo);
    purchase = normalizeApple(current, accountId, current.transactionId || proof, environment);
    if (latest.status === 4 && latest.signedRenewalInfo) {
      const renewal = await verifier.verifyAndDecodeRenewalInfo(latest.signedRenewalInfo);
      if (renewal.originalTransactionId !== current.originalTransactionId) throw new BillingError('Subscription renewal mismatch');
      purchase.validUntil = new Date(renewal.gracePeriodExpiresDate || 0);
    }
    purchase.revoked ||= latest.status !== 1 && latest.status !== 4;
  }
  return purchase;
}

// Minimal typed Play API responses; all entitlement fields below come from Google's authenticated API.
export interface PlayPurchase {
  purchaseState?: number; quantity?: number; obfuscatedExternalAccountId?: string;
  testPurchase?: unknown; purchaseType?: number; subscriptionState?: string;
  acknowledgementState?: number | string; consumptionState?: number;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string }[];
}
export function normalizeGoogle(data: PlayPurchase, productId: string, accountId: string, proof: string, sandbox = false): VerifiedPurchase {
  const product = productFor(productId);
  const boundAccount = product.kind === 'subscription' ? data.externalAccountIdentifiers?.obfuscatedExternalAccountId : data.obfuscatedExternalAccountId;
  if (boundAccount !== accountId) throw new BillingError('Purchase does not belong to this account', 403);
  if (!sandbox && (data.testPurchase !== undefined || data.purchaseType === 0)) throw new BillingError('Test purchases are disabled', 403);
  const activeStates = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'];
  let validUntil: Date | null = null;
  let revoked = data.purchaseState !== 0;
  if (product.kind === 'subscription') {
    const line = data.lineItems?.filter(item => item.productId === productId).sort((a,b) => Date.parse(b.expiryTime || '') - Date.parse(a.expiryTime || ''))[0];
    if (!line) throw new BillingError('Subscription/product mismatch');
    validUntil = new Date(line.expiryTime || '');
    if (!Number.isFinite(validUntil.getTime())) throw new BillingError('Invalid subscription expiry');
    revoked = !activeStates.includes(data.subscriptionState || '');
  } else if ((data.quantity ?? 1) !== 1) throw new BillingError('Multi-quantity purchases are not supported');
  return { store:'google', purchaseId:createHash('sha256').update(proof).digest('hex'), accountId, productId, kind:product.kind, reportType:product.reportType, validUntil, revoked, proof };
}
async function googleClient() {
  const credentials = JSON.parse(required('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'));
  return new GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/androidpublisher'] }).getClient();
}
export async function readGooglePurchase(proof: string, productId?: string): Promise<PlayPurchase> {
  if (!proof || proof.length > 8192) throw new BillingError('Invalid purchase proof');
  const client = await googleClient();
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${bundleId}/purchases`;
  const suffix = productId ? `/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(proof)}` : `/subscriptionsv2/tokens/${encodeURIComponent(proof)}`;
  if (productId) productFor(productId);
  return (await client.request<PlayPurchase>({ url:base+suffix, timeout:15000 })).data;
}
export async function completeGooglePurchase(purchase: VerifiedPurchase) {
  if (purchase.revoked || (purchase.validUntil && purchase.validUntil.getTime() <= Date.now())) return;
  const data = await readGooglePurchase(purchase.proof, purchase.kind === 'consumable' ? purchase.productId : undefined);
  const action = purchase.kind === 'consumable' ? 'consume' : 'acknowledge';
  if ((action === 'consume' && data.consumptionState === 1) || (action === 'acknowledge' && data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED')) return;
  const client = await googleClient();
  const kind = purchase.kind === 'consumable' ? 'products' : 'subscriptions';
  await client.request({ method:'POST', url:`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${bundleId}/purchases/${kind}/${encodeURIComponent(purchase.productId)}/tokens/${encodeURIComponent(purchase.proof)}:${action}`, data:{}, timeout:15000 });
}
async function verifyGoogle(proof: string, productId: string, accountId: string) {
  const product = productFor(productId);
  const data = await readGooglePurchase(proof,product.kind === 'consumable' ? productId : undefined);
  return normalizeGoogle(data, productId, accountId, proof, process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === 'true');
}
export async function verifyStorePurchase(store: Store, proof: string, productId: string, accountId: string): Promise<VerifiedPurchase> {
  productFor(productId);
  if (!proof || proof.length > 8192) throw new BillingError('Invalid purchase proof');
  try { return store === 'apple' ? await verifyApple(proof, productId, accountId) : await verifyGoogle(proof, productId, accountId); }
  catch (error) {
    if (error instanceof BillingError) throw error;
    const upstream = error as { httpStatusCode?: number; response?: { status?: number } };
    if ([404,410].includes(upstream.httpStatusCode || upstream.response?.status || 0)) throw new BillingError('Purchase is no longer available',410);
    // Never expose upstream error bodies: Google errors can contain purchase tokens.
    throw new BillingError('Store verification is unavailable. Retry or restore purchases; access has not been granted.', 503);
  }
}

export function assertStoreConfigured(store: Store) {
  if (store === 'apple') { appleServices(); createPrivateKey(required('APPLE_IAP_PRIVATE_KEY').replace(/\\n/g, '\n')); }
  else {
    const credentials = JSON.parse(required('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'));
    if (!credentials.client_email || !credentials.private_key) throw new BillingError('Play billing is not configured',503);
    createPrivateKey(credentials.private_key);
  }
}
