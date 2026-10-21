import { NextResponse } from 'next/server';
import { verifyWalletAuth } from '../dynamic-auth';
import { BillingError } from './catalog';
import { mobileBillingEnabled } from './ledger';
export async function authenticatedBillingWallet(request: Request, wallet: unknown) {
  if (!mobileBillingEnabled()) throw new BillingError('Store billing is not configured', 503);
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new BillingError('Invalid account',400);
  const auth = await verifyWalletAuth(request.headers.get('authorization'),wallet);
  if (!auth.ok) throw new BillingError(auth.error || 'Authentication required',auth.status || 401);
  return wallet.toLowerCase();
}
export function billingFailure(error: unknown) {
  const safe = error instanceof BillingError ? error : new BillingError('Store billing is unavailable. Please try again.',503);
  return NextResponse.json({ error:safe.message },{ status:safe.status, headers:{'Cache-Control':'no-store'} });
}
