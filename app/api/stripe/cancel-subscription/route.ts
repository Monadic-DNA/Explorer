import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

export async function POST(request: NextRequest) {
  try {
    // Get wallet address from the authenticated user (would typically come from session/auth)
    // For now, we'll require it in the request body
    const body = await request.json().catch(() => ({}));
    const { walletAddress } = body;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }

    const normalizedAddress = walletAddress.toLowerCase();

    // Find all customers with this wallet address
    const customers = await stripe.customers.search({
      query: `metadata['walletAddress']:'${normalizedAddress}'`,
      limit: 100,
    });

    if (customers.data.length === 0) {
      return NextResponse.json(
        { error: 'No subscription found for this wallet address' },
        { status: 404 }
      );
    }

    // Find all active subscriptions for these customers
    const cancelledSubscriptions: string[] = [];
    
    for (const customer of customers.data) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 100,
      });

      // Cancel all active subscriptions (cancel at period end)
      for (const subscription of subscriptions.data) {
        const updated = await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: true,
        });
        cancelledSubscriptions.push(subscription.id);
        console.log(`[Stripe] Cancelled subscription: ${subscription.id} for wallet ${walletAddress}`, {
          cancel_at_period_end: updated.cancel_at_period_end,
          current_period_end: new Date(updated.current_period_end * 1000).toISOString(),
          status: updated.status,
        });
      }
    }

    if (cancelledSubscriptions.length === 0) {
      return NextResponse.json(
        { error: 'No active subscriptions found to cancel' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${cancelledSubscriptions.length} subscription(s) will be cancelled at the end of the billing period`,
      cancelledSubscriptions,
    });
  } catch (error: any) {
    console.error('[Stripe] Subscription cancellation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to cancel subscription',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
