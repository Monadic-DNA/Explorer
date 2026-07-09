import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { isPaidReportType, PAID_REPORT_TYPES, PaidReportType } from '@/lib/report-access';

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

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, reportType, action = 'check' } = await request.json();
    const normalizedWallet = validateWalletAddress(walletAddress);

    if (!normalizedWallet) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }

    if (action === 'check') {
      const payments = await findUnusedReportPayments(normalizedWallet);
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

    if (action === 'consume') {
      if (!isPaidReportType(reportType)) {
        return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
      }

      const payments = await findUnusedReportPayments(normalizedWallet, reportType);
      const paymentToConsume = payments.sort((a, b) => a.created - b.created)[0];

      if (!paymentToConsume) {
        return NextResponse.json(
          { success: false, error: 'No unused report pass found' },
          { status: 402 }
        );
      }

      await stripe.paymentIntents.update(paymentToConsume.id, {
        metadata: {
          ...paymentToConsume.metadata,
          consumedAt: new Date().toISOString(),
        },
      });

      return NextResponse.json({
        success: true,
        consumedPaymentIntentId: paymentToConsume.id,
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
