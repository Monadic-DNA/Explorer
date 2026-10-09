import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyWalletAuth } from '@/lib/dynamic-auth';
import {
  METADATA_REPORT_DISCOUNT_USED,
  METADATA_SUBSCRIPTION_DISCOUNT_USED,
  METADATA_TWITTER_ID,
  reportReplyCorpConversion,
} from '@/lib/replycorp';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-09-30.endive',
});

/**
 * Reports a completed Stripe purchase to ReplyCorp. The client calls this after a payment
 * succeeds; the server re-checks the payment with Stripe so a browser cannot fake one.
 * Pass either subscriptionId (card subscription) or checkoutSessionId (one-time report).
 */
export async function POST(request: NextRequest) {
  try {
    const { walletAddress, subscriptionId, checkoutSessionId } = await request.json();

    if (typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }
    if (!subscriptionId && !checkoutSessionId) {
      return NextResponse.json({ error: 'subscriptionId or checkoutSessionId required' }, { status: 400 });
    }

    const auth = await verifyWalletAuth(request.headers.get('authorization'), walletAddress);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
    }

    const normalizedWallet = walletAddress.toLowerCase();
    let customerId: string;
    let amountCents: number;
    let transactionHash: string;
    let discountKey: string;

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
      const invoice = subscription.latest_invoice as Stripe.Invoice | null;
      if (subscription.metadata?.walletAddress !== normalizedWallet || !invoice || invoice.status !== 'paid') {
        return NextResponse.json({ error: 'No paid subscription found for this wallet' }, { status: 404 });
      }
      customerId = subscription.customer as string;
      amountCents = invoice.amount_paid;
      transactionHash = invoice.id!;
      discountKey = METADATA_SUBSCRIPTION_DISCOUNT_USED;
    } else {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (session.metadata?.walletAddress !== normalizedWallet || session.payment_status !== 'paid' || !session.customer) {
        return NextResponse.json({ error: 'No paid checkout found for this wallet' }, { status: 404 });
      }
      customerId = session.customer as string;
      amountCents = session.amount_total ?? 0;
      transactionHash = session.id;
      discountKey = METADATA_REPORT_DISCOUNT_USED;
    }

    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const twitterId = customer.metadata?.[METADATA_TWITTER_ID];
    if (!twitterId) {
      return NextResponse.json({ success: true, reported: false, reason: 'X account not connected' });
    }

    // The first paid subscription month or report uses up the one-time connect discount
    if (!customer.metadata?.[discountKey]) {
      await stripe.customers.update(customer.id, { metadata: { [discountKey]: 'true' } });
    }

    // A fully discounted $0 payment is not a sale; the signup was already reported at connect
    if (amountCents <= 0) {
      return NextResponse.json({ success: true, reported: false, reason: 'No amount paid' });
    }

    const result = await reportReplyCorpConversion({
      twitterId,
      eventType: 'purchase',
      amount: amountCents / 100,
      transactionHash,
    });

    return NextResponse.json({ success: true, reported: result.ok });
  } catch (error: any) {
    console.error('[ReplyCorp] Conversion route error:', error);
    return NextResponse.json({ error: 'Failed to report conversion' }, { status: 500 });
  }
}
