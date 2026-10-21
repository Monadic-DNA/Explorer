import { NextResponse } from 'next/server';
import { appleServices, verifyStorePurchase } from '@/lib/store-billing/verification';
import { mobileBillingEnabled, recordPurchase } from '@/lib/store-billing/ledger';
import { BillingError } from '@/lib/store-billing/catalog';
import { billingFailure } from '@/lib/store-billing/http';
import { getDb } from '@/lib/db';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (!mobileBillingEnabled()) throw new BillingError('Billing is not configured',503);
    const body = await request.json();
    if (typeof body.signedPayload !== 'string' || body.signedPayload.length > 100000) throw new BillingError('Invalid notification');
    const { verifier } = appleServices();
    const notification = await verifier.verifyAndDecodeNotification(body.signedPayload);
    if (notification.data?.signedTransactionInfo) {
      const tx = await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo);
      if (!tx.appAccountToken || !tx.transactionId || !tx.productId) throw new BillingError('Missing purchase account');
      const owner = await getDb().query('SELECT id FROM mobile_billing_accounts WHERE id=$1',[tx.appAccountToken]);
      if (owner.rowCount) await recordPurchase(await verifyStorePurchase('apple',tx.transactionId,tx.productId,tx.appAccountToken.toLowerCase()));
    }
    return new NextResponse(null,{status:204});
  } catch (error) { return billingFailure(error); }
}
