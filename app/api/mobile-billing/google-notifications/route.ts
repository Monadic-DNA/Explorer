import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { readGooglePurchase, verifyStorePurchase, completeGooglePurchase } from '@/lib/store-billing/verification';
import { mobileBillingEnabled, recordPurchase } from '@/lib/store-billing/ledger';
import { BillingError, catalog, required } from '@/lib/store-billing/catalog';
import { billingFailure } from '@/lib/store-billing/http';
import { getDb } from '@/lib/db';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (!mobileBillingEnabled()) throw new BillingError('Billing is not configured',503);
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new BillingError('Authentication required',401);
    const ticket = await new OAuth2Client().verifyIdToken({ idToken:authorization.slice(7), audience:required('GOOGLE_RTDN_AUDIENCE') });
    const identity = ticket.getPayload();
    if (identity?.email !== required('GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL') || identity.email_verified !== true) throw new BillingError('Invalid notification identity',403);
    const body = await request.json();
    if (typeof body.message?.data !== 'string' || body.message.data.length > 100000) throw new BillingError('Invalid notification');
    const notification = JSON.parse(Buffer.from(body.message.data,'base64').toString('utf8'));
    if (notification.packageName !== 'com.monadicdna.explorer') throw new BillingError('Incorrect package');
    const oneTime = notification.oneTimeProductNotification;
    const subscription = notification.subscriptionNotification;
    const voided = notification.voidedPurchaseNotification;
    const proof = oneTime?.purchaseToken || subscription?.purchaseToken || voided?.purchaseToken;
    if (typeof proof !== 'string' || !proof || proof.length > 8192) {
      if (notification.testNotification) return new NextResponse(null,{status:204});
      throw new BillingError('Missing purchase token');
    }
    let productId: string | undefined = oneTime?.sku;
    let accountId: string | undefined;
    if (voided) {
      const existing = await getDb().query('SELECT product_id,account_id FROM mobile_store_purchases WHERE store=$1 AND purchase_id=$2',['google',createHash('sha256').update(proof).digest('hex')]);
      productId = existing.rows[0]?.product_id; accountId = existing.rows[0]?.account_id;
      if (!accountId) return new NextResponse(null,{status:204});
    } else {
      const data = await readGooglePurchase(proof,productId);
      productId ||= data.lineItems?.find(line => catalog.some(product => product.id===line.productId))?.productId;
      accountId = oneTime ? data.obfuscatedExternalAccountId : data.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    }
    if (!productId || !accountId || !/^[0-9a-f-]{36}$/i.test(accountId)) throw new BillingError('Missing purchase account/product');
    const owner = await getDb().query('SELECT id FROM mobile_billing_accounts WHERE id=$1',[accountId]);
    if (owner.rowCount) {
      const purchase = await verifyStorePurchase('google',proof,productId,accountId);
      await recordPurchase(purchase);
      await completeGooglePurchase(purchase);
    }
    return new NextResponse(null,{status:204});
  } catch (error) { return billingFailure(error); }
}
