// CRITICAL: Apply fetch polyfill BEFORE any other imports
import '@/lib/fetch-polyfill';

import { NextRequest, NextResponse } from 'next/server';
import { checkCombinedSubscription } from '@/lib/subscription-manager';

export async function POST(request: NextRequest) {
  try {
    const { walletAddress } = await request.json();

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }

    // Validate wallet address format (basic check)
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Query both blockchain (Alchemy) and Stripe payments
    // Combined subscription includes payments from both sources
    console.log('[Subscription Check] Checking combined subscription (blockchain + Stripe)');
    const subscription = await checkCombinedSubscription(walletAddress);

    return NextResponse.json({
      success: true,
      subscription: {
        isActive: subscription.isActive,
        expiresAt: subscription.expiresAt?.toISOString() || null,
        daysRemaining: subscription.daysRemaining,
        totalDaysPurchased: subscription.totalDaysPurchased,
        totalPaid: subscription.totalPaid,
        paymentCount: subscription.payments.length,
      },
    });
  } catch (error) {
    console.error('Subscription check error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check subscription',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
