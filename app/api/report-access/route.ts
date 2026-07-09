import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { isPaidReportType, PAID_REPORT_TYPES, PaidReportType } from '@/lib/report-access';
import { verifyWalletAuth } from '@/lib/dynamic-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

function validateWalletAddress(walletAddress: unknown): string | null {
  if (typeof walletAddress !== 'string') return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return null;
  return walletAddress.toLowerCase();
}

function stripeSearchValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isReportPayment(payment: Stripe.PaymentIntent, walletAddress: string) {
  return (
    payment.status === 'succeeded' &&
    payment.metadata.purpose === 'report_one_time' &&
    payment.metadata.walletAddress === walletAddress
  );
}

async function findUnusedReportPayments(walletAddress: string, reportType?: PaidReportType) {
  const clauses = [
    `metadata['walletAddress']:'${stripeSearchValue(walletAddress)}'`,
    `metadata['purpose']:'report_one_time'`,
    `status:'succeeded'`,
  ];

  if (reportType) {
    clauses.push(`metadata['reportType']:'${stripeSearchValue(reportType)}'`);
  }

  const result = await stripe.paymentIntents.search({
    query: clauses.join(' AND '),
    limit: 100,
  });

  return result.data.filter(payment => !payment.metadata.consumedAt);
}

// Stripe search is eventually consistent and can lag behind a checkout that
// just completed. When the client passes the checkout session id from the
// success redirect, resolve the payment intent directly so the new pass is
// visible immediately.
async function findPaymentFromCheckoutSession(sessionId: string, walletAddress: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    if (session.payment_status !== 'paid') return null;

    const payment = session.payment_intent;
    if (!payment || typeof payment === 'string') return null;
    if (!isReportPayment(payment, walletAddress)) return null;
    if (payment.metadata.consumedAt) return null;

    return payment;
  } catch (error) {
    console.error('Failed to resolve checkout session:', error);
    return null;
  }
}

async function collectUnusedPayments(
  walletAddress: string,
  sessionId: string | undefined,
  reportType?: PaidReportType
) {
  const payments = await findUnusedReportPayments(walletAddress, reportType);

  if (typeof sessionId === 'string' && sessionId.startsWith('cs_')) {
    const sessionPayment = await findPaymentFromCheckoutSession(sessionId, walletAddress);
    if (
      sessionPayment &&
      (!reportType || sessionPayment.metadata.reportType === reportType) &&
      !payments.some(payment => payment.id === sessionPayment.id)
    ) {
      payments.push(sessionPayment);
    }
  }

  return payments;
}

// Consumes one pass with an optimistic concurrency guard. Stripe metadata
// updates are last-writer-wins, so after stamping the payment intent we read
// it back and only treat the consumption as ours when our token survived.
async function consumeOnePayment(payments: Stripe.PaymentIntent[]) {
  const candidates = [...payments].sort((a, b) => a.created - b.created);

  for (const candidate of candidates) {
    const fresh = await stripe.paymentIntents.retrieve(candidate.id);
    if (fresh.metadata.consumedAt) continue;

    const consumeToken = randomUUID();
    await stripe.paymentIntents.update(candidate.id, {
      metadata: {
        ...fresh.metadata,
        consumedAt: new Date().toISOString(),
        consumeToken,
      },
    });

    const verified = await stripe.paymentIntents.retrieve(candidate.id);
    if (verified.metadata.consumeToken === consumeToken) {
      return candidate.id;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, reportType, action = 'check', sessionId } =
      await request.json();
    const normalizedWallet = validateWalletAddress(walletAddress);

    if (!normalizedWallet) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    if (action === 'check') {
      const payments = await collectUnusedPayments(normalizedWallet, sessionId);
      const availableReports = Object.fromEntries(
        PAID_REPORT_TYPES.map(type => [
          type,
          payments.filter(payment => payment.metadata.reportType === type).length,
        ])
      );

      return NextResponse.json({
        success: true,
        availableReports,
      });
    }

    // Consuming passes mutates paid state, so it requires proof that the
    // caller owns the wallet.
    if (action === 'consume') {
      const auth = await verifyWalletAuth(request.headers.get('authorization'), normalizedWallet);
      if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
      }
    }

    if (action === 'consume') {
      if (!isPaidReportType(reportType)) {
        return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
      }

      const payments = await collectUnusedPayments(normalizedWallet, sessionId, reportType);
      const consumedPaymentIntentId = await consumeOnePayment(payments);

      if (!consumedPaymentIntentId) {
        return NextResponse.json(
          { success: false, error: 'No unused report pass found' },
          { status: 402 }
        );
      }

      return NextResponse.json({
        success: true,
        consumedPaymentIntentId,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Report access check failed:', error);

    return NextResponse.json(
      {
        error: 'Failed to check report access',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
