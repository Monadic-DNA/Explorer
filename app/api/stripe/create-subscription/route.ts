import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

export async function POST(request: NextRequest) {
  try {
    const { walletAddress } = await request.json();

    // Validate inputs
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Validate Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe is not configured' },
        { status: 500 }
      );
    }

    if (!process.env.STRIPE_PRICE_ID) {
      return NextResponse.json(
        { error: 'Stripe price is not configured. Set STRIPE_PRICE_ID environment variable.' },
        { status: 500 }
      );
    }

    // Create or retrieve customer
    // Note: Stripe API doesn't support filtering customers by metadata in list()
    // We need to search by email or create a new customer each time
    // For this use case, we'll create a new customer per subscription
    const customer = await stripe.customers.create({
      metadata: {
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price: process.env.STRIPE_PRICE_ID,
        },
      ],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

    console.log(`[Stripe] Created subscription: ${subscription.id} for wallet ${walletAddress}`);

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error: any) {
    console.error('Stripe subscription creation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to create subscription',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
