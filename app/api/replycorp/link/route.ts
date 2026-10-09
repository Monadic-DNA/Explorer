import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyWalletAuth } from '@/lib/dynamic-auth';
import { createWalletCustomer, searchWalletCustomers } from '@/lib/stripe-customers';
import {
  METADATA_REPORT_DISCOUNT_USED,
  METADATA_SUBSCRIPTION_DISCOUNT_USED,
  METADATA_TWITTER_HANDLE,
  METADATA_TWITTER_ID,
  reportReplyCorpConversion,
} from '@/lib/replycorp';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-09-30.endive',
});

/**
 * Links the X account a user connected through ReplyCorp's widget to their wallet.
 * The X id is stored in Stripe customer metadata so the server can attribute later
 * purchases and apply the connect discount without a database.
 */
export async function POST(request: NextRequest) {
  try {
    const { walletAddress, twitterId, handle } = await request.json();

    if (typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }
    if (typeof twitterId !== 'string' || !/^\d{1,25}$/.test(twitterId)) {
      return NextResponse.json({ error: 'Invalid X user id' }, { status: 400 });
    }

    const auth = await verifyWalletAuth(request.headers.get('authorization'), walletAddress);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    const normalizedWallet = walletAddress.toLowerCase();
    const xHandle = typeof handle === 'string' ? handle.slice(0, 50) : '';

    const existing = await searchWalletCustomers(stripe, normalizedWallet);
    const customers = existing.length > 0 ? existing : [await createWalletCustomer(stripe, normalizedWallet)];

    const wasLinked = customers.some(c => c.metadata?.[METADATA_TWITTER_ID] === twitterId);

    // Keep every customer for this wallet in sync so whichever one Stripe returns later has the id
    for (const customer of customers) {
      if (customer.metadata?.[METADATA_TWITTER_ID] !== twitterId || customer.metadata?.[METADATA_TWITTER_HANDLE] !== xHandle) {
        await stripe.customers.update(customer.id, {
          metadata: { [METADATA_TWITTER_ID]: twitterId, [METADATA_TWITTER_HANDLE]: xHandle },
        });
      }
    }

    if (!wasLinked) {
      console.log(`[ReplyCorp] Linked X account to wallet ${normalizedWallet}`);
      await reportReplyCorpConversion({
        twitterId,
        eventType: 'signup',
        transactionHash: `signup:${normalizedWallet}:${twitterId}`,
      });
    }

    return NextResponse.json({
      success: true,
      subscriptionDiscountAvailable: !customers.some(c => c.metadata?.[METADATA_SUBSCRIPTION_DISCOUNT_USED]),
      reportDiscountAvailable: !customers.some(c => c.metadata?.[METADATA_REPORT_DISCOUNT_USED]),
    });
  } catch (error: any) {
    console.error('[ReplyCorp] Link error:', error);
    return NextResponse.json({ error: 'Failed to link X account' }, { status: 500 });
  }
}
