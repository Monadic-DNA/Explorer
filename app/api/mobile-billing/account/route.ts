import { NextResponse } from 'next/server';
import { billingAccount, tokenKey } from '@/lib/store-billing/ledger';
import { authenticatedBillingWallet, billingFailure } from '@/lib/store-billing/http';
import { assertStoreConfigured } from '@/lib/store-billing/verification';
import { BillingError, catalog } from '@/lib/store-billing/catalog';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const wallet = await authenticatedBillingWallet(request,body.walletAddress);
    if (body.store !== 'apple' && body.store !== 'google') throw new BillingError('Invalid store');
    tokenKey(); assertStoreConfigured(body.store);
    return NextResponse.json({ accountId:await billingAccount(wallet), products:catalog },{ headers:{'Cache-Control':'no-store'} });
  } catch (error) { return billingFailure(error); }
}
