import { NextResponse } from 'next/server';
import { billingAccount, recordPurchase } from '@/lib/store-billing/ledger';
import { authenticatedBillingWallet, billingFailure } from '@/lib/store-billing/http';
import { BillingError } from '@/lib/store-billing/catalog';
import { completeGooglePurchase, verifyStorePurchase } from '@/lib/store-billing/verification';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const wallet = await authenticatedBillingWallet(request,body.walletAddress);
    if ((body.store !== 'apple' && body.store !== 'google') || typeof body.proof !== 'string' || typeof body.productId !== 'string') throw new BillingError('Invalid purchase');
    const purchase = await verifyStorePurchase(body.store,body.proof,body.productId,await billingAccount(wallet));
    await recordPurchase(purchase); // Idempotent durable commit happens before client finish/acknowledgement/consumption.
    if (purchase.store === 'google') await completeGooglePurchase(purchase);
    return NextResponse.json({ accepted:true },{ headers:{'Cache-Control':'no-store'} });
  } catch (error) { return billingFailure(error); }
}
