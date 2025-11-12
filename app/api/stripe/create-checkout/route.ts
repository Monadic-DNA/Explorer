import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

const DAYS_PER_MONTH = 30;

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

    // Get the base URL for redirect
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Create Stripe Checkout Session for subscription
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription', // Recurring subscription
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // Reference existing price from Stripe Dashboard
          quantity: 1,
        },
      ],
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/cancel`,
      metadata: {
        walletAddress: walletAddress.toLowerCase(),
      },
      subscription_data: {
        metadata: {
          walletAddress: walletAddress.toLowerCase(),
        },
      },
      customer_email: undefined, // Optional: can be pre-filled if user provides email
    });

    console.log(`[Stripe] Created subscription checkout session: ${session.id} for wallet ${walletAddress}`);

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
    });
  } catch (error: any) {
    console.error('Stripe checkout creation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to create checkout session',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
