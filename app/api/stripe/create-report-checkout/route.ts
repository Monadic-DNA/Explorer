import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  isPaidReportType,
  ONE_TIME_REPORT_PRICE_CENTS,
  PAID_REPORT_LABELS,
} from '@/lib/report-access';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

async function getOrCreateCustomer(walletAddress: string) {
  const normalizedWallet = walletAddress.toLowerCase();
  const existingCustomers = await stripe.customers.search({
    query: `metadata['walletAddress']:'${normalizedWallet}'`,
    limit: 1,
  });

  if (existingCustomers.data[0]) {
    return existingCustomers.data[0];
  }

  return stripe.customers.create({
    metadata: {
      walletAddress: normalizedWallet,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, reportType } = await request.json();

    if (!walletAddress) {
      return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    if (!isPaidReportType(reportType)) {
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    const requestOrigin = request.headers.get('origin');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'http';
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const origin =
      requestOrigin ||
      process.env.NEXT_PUBLIC_APP_URL ||
      (forwardedHost ? `${forwardedProto}://${forwardedHost}` : 'http://localhost:3001');

    const normalizedWallet = walletAddress.toLowerCase();
    const customer = await getOrCreateCustomer(walletAddress);
    const reportLabel = PAID_REPORT_LABELS[reportType];

    const metadata = {
      walletAddress: normalizedWallet,
      reportType,
      purpose: 'report_one_time',
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer: customer.id,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: ONE_TIME_REPORT_PRICE_CENTS,
            product_data: {
              name: `${reportLabel} run`,
              description: 'One-time access to generate this premium report once.',
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/overview-report?report_purchase=success&report_type=${reportType}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/overview-report?report_purchase=cancelled&report_type=${reportType}`,
      metadata,
      payment_intent_data: {
        metadata,
      },
    });

    console.log(`[Stripe] Created one-time report checkout session: ${session.id} for ${reportType}`);

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
    });
  } catch (error: any) {
    console.error('Stripe report checkout creation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to create report checkout session',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
