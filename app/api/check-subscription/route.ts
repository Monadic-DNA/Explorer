// CRITICAL: Apply fetch polyfill BEFORE any other imports
import '@/lib/fetch-polyfill';

import { NextRequest, NextResponse } from 'next/server';
import { checkCombinedSubscription } from '@/lib/subscription-manager';
import { mobileBillingEnabled, mobileEntitlements } from '@/lib/store-billing/ledger';
import { verifyWalletAuth } from '@/lib/dynamic-auth';

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

    if (mobileBillingEnabled() && request.headers.get('authorization')) {
      const auth = await verifyWalletAuth(request.headers.get('authorization'), walletAddress);
      if (!auth.ok) return NextResponse.json({ error:auth.error }, { status:auth.status || 401 });
      const mobile = await mobileEntitlements(walletAddress);
      if (mobile.isActive) {
        return NextResponse.json({ success:true, subscription:{
          isActive:true, expiresAt:mobile.expiresAt?.toISOString(),
          daysRemaining:Math.max(0,Math.ceil((mobile.expiresAt!.getTime()-Date.now())/86400000)),
          totalDaysPurchased:0, totalPaid:0, paymentCount:0, source:'app_store_or_google_play',
        } }, { headers:{'Cache-Control':'no-store'} });
      }
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
        willRenew: subscription.willRenew ?? false,
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
