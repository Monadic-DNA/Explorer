/**
 * Stripe Subscription Manager
 * Handles direct Stripe API queries for subscription status
 * Works alongside blockchain payment verification (subscription-indexer.ts)
 */

import Stripe from 'stripe';
import { checkSubscription as checkBlockchainSubscription, SubscriptionStatus, PaymentRecord } from './subscription-indexer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

const MONTHLY_PRICE = 4.99; // USD
const DAYS_PER_MONTH = 30;

/**
 * Check Stripe subscription status for a wallet address by querying Stripe API directly
 * Similar to how we query Alchemy for blockchain payments
 */
export async function checkStripeSubscription(walletAddress: string): Promise<SubscriptionStatus> {
  const normalizedAddress = walletAddress.toLowerCase();

  console.log('[Stripe Manager] Checking Stripe subscription for wallet:', normalizedAddress);

  try {
    // Query Stripe API for all customers with this wallet address in metadata
    const customers = await stripe.customers.search({
      query: `metadata['walletAddress']:'${normalizedAddress}'`,
      limit: 100,
    });

    console.log(`[Stripe Manager] Found ${customers.data.length} customers with wallet address ${normalizedAddress}`);

    if (customers.data.length === 0) {
      console.log('[Stripe Manager] No Stripe customers found - subscription inactive');
      return {
        isActive: false,
        expiresAt: null,
        daysRemaining: 0,
        totalDaysPurchased: 0,
        totalPaid: 0,
        payments: [],
      };
    }

    // Collect all active subscriptions from all customers
    const allSubscriptions: Stripe.Subscription[] = [];

    for (const customer of customers.data) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 100,
      });

      allSubscriptions.push(...subscriptions.data);
    }

    console.log(`[Stripe Manager] Found ${allSubscriptions.length} active subscriptions`);

    if (allSubscriptions.length === 0) {
      console.log('[Stripe Manager] No active subscriptions found');
      return {
        isActive: false,
        expiresAt: null,
        daysRemaining: 0,
        totalDaysPurchased: 0,
        totalPaid: 0,
        payments: [],
      };
    }

    // Find the subscription with the latest current_period_end
    const latestSubscription = allSubscriptions.reduce((latest, sub) => {
      return sub.current_period_end > latest.current_period_end ? sub : latest;
    });

    const expiresAt = new Date(latestSubscription.current_period_end * 1000);
    const now = Date.now();
    const isActive = now < expiresAt.getTime();
    const daysRemaining = isActive
      ? Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))
      : 0;

    console.log('[Stripe Manager] Active subscription found:', {
      subscriptionId: latestSubscription.id,
      status: latestSubscription.status,
      currentPeriodEnd: expiresAt.toISOString(),
      isActive,
      daysRemaining,
    });

    // Calculate total paid and days from all subscription periods
    // Note: For simplicity, we approximate based on subscription status
    // In production, you might want to query invoice history for exact totals
    const totalMonthsActive = Math.ceil((now - latestSubscription.created * 1000) / (30 * 24 * 60 * 60 * 1000));
    const totalPaid = totalMonthsActive * MONTHLY_PRICE;
    const totalDaysPurchased = totalMonthsActive * DAYS_PER_MONTH;

    // Create payment record for display (approximation)
    const paymentRecord: PaymentRecord = {
      transactionHash: latestSubscription.id,
      timestamp: latestSubscription.created,
      amount: MONTHLY_PRICE,
      currency: 'USD',
      usdValue: MONTHLY_PRICE,
      daysPurchased: DAYS_PER_MONTH,
      chain: 'stripe',
      type: 'payment',
    };

    const result = {
      isActive,
      expiresAt,
      daysRemaining,
      totalDaysPurchased,
      totalPaid,
      payments: [paymentRecord],
    };

    console.log('[Stripe Manager] Returning subscription result:', {
      isActive: result.isActive,
      daysRemaining: result.daysRemaining,
      expiresAt: result.expiresAt?.toISOString(),
    });

    return result;
  } catch (error) {
    console.error('[Stripe Manager] Failed to check Stripe subscription:', error);
    if (error instanceof Error) {
      console.error('[Stripe Manager] Error details:', error.message);
    }
    // Return inactive status on error instead of throwing
    return {
      isActive: false,
      expiresAt: null,
      daysRemaining: 0,
      totalDaysPurchased: 0,
      totalPaid: 0,
      payments: [],
    };
  }
}

/**
 * Combine blockchain and Stripe subscription data
 * Merges payment records and calculates combined subscription status
 */
export async function checkCombinedSubscription(walletAddress: string): Promise<SubscriptionStatus> {
  // Helper to add timeout to promises
  const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, defaultValue: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(defaultValue), timeoutMs))
    ]);
  };

  const emptySubscription: SubscriptionStatus = {
    isActive: false,
    expiresAt: null,
    daysRemaining: 0,
    totalDaysPurchased: 0,
    totalPaid: 0,
    payments: [],
  };

  console.log('[Combined Check] Checking both blockchain and Stripe subscriptions for:', walletAddress);

  // Query both sources in parallel with timeout
  const [blockchainSub, stripeSub] = await Promise.all([
    withTimeout(
      checkBlockchainSubscription(walletAddress).catch(err => {
        console.error('[Combined Check] ❌ Blockchain subscription check FAILED with error:', err);
        console.error('[Combined Check] Error message:', err.message);
        console.error('[Combined Check] Error stack:', err.stack);
        return emptySubscription;
      }),
      10000, // 10 second timeout for blockchain check (multiple chains can be slow)
      emptySubscription
    ).then(result => {
      if (result === emptySubscription && result.payments.length === 0) {
        console.log('[Combined Check] ⚠️  Blockchain check returned empty (likely timeout or error)');
      } else {
        console.log('[Combined Check] ✅ Blockchain check completed successfully');
      }
      return result;
    }),
    withTimeout(
      checkStripeSubscription(walletAddress).catch(err => {
        console.error('[Combined Check] Stripe subscription check failed:', err);
        return emptySubscription;
      }),
      5000, // 5 second timeout for Stripe API check
      emptySubscription
    ),
  ]);

  console.log('[Combined Check] Results:', {
    blockchainActive: blockchainSub.isActive,
    stripeActive: stripeSub.isActive,
    blockchainPayments: blockchainSub.payments.length,
    stripePayments: stripeSub.payments.length,
  });

  // If either subscription is active, user has access
  // Use the subscription with the latest expiration date
  if (blockchainSub.isActive || stripeSub.isActive) {
    // Find the subscription that expires latest
    const activeSubscription =
      !blockchainSub.expiresAt ? stripeSub :
      !stripeSub.expiresAt ? blockchainSub :
      blockchainSub.expiresAt > stripeSub.expiresAt ? blockchainSub : stripeSub;

    // Combine payment records for history
    const allPayments = [...blockchainSub.payments, ...stripeSub.payments].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    const result = {
      isActive: true,
      expiresAt: activeSubscription.expiresAt,
      daysRemaining: activeSubscription.daysRemaining,
      totalDaysPurchased: blockchainSub.totalDaysPurchased + stripeSub.totalDaysPurchased,
      totalPaid: blockchainSub.totalPaid + stripeSub.totalPaid,
      payments: allPayments,
    };

    console.log('[Combined Check] User has active subscription:', {
      expiresAt: result.expiresAt?.toISOString(),
      daysRemaining: result.daysRemaining,
      paymentsCount: result.payments.length,
      paymentChains: result.payments.map(p => p.chain),
    });

    return result;
  }

  // No active subscriptions
  console.log('[Combined Check] No active subscriptions found');

  return {
    isActive: false,
    expiresAt: null,
    daysRemaining: 0,
    totalDaysPurchased: blockchainSub.totalDaysPurchased + stripeSub.totalDaysPurchased,
    totalPaid: blockchainSub.totalPaid + stripeSub.totalPaid,
    payments: [...blockchainSub.payments, ...stripeSub.payments].sort(
      (a, b) => a.timestamp - b.timestamp
    ),
  };
}
