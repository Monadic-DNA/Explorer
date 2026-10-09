/**
 * ReplyCorp Referrals integration (server-side only)
 *
 * Users can optionally connect their X account through ReplyCorp's Connect-on-X widget.
 * We store the X user id in Stripe customer metadata (no database) and report
 * conversions to ReplyCorp from the server, which ReplyCorp requires. The commission on
 * each purchase funds rewards for the X users whose posts drove it; ReplyCorp keeps 15%.
 *
 * Docs: https://docs.replycorp.io/integration-guide.md
 */

import Stripe from 'stripe';

const REPLYCORP_API_BASE = 'https://prod.api.replycorp.io/api/v1';

// Stripe customer metadata keys
export const METADATA_TWITTER_ID = 'twitterId';
export const METADATA_TWITTER_HANDLE = 'twitterHandle';
export const METADATA_SUBSCRIPTION_DISCOUNT_USED = 'xConnectSubscriptionDiscountUsed';
export const METADATA_REPORT_DISCOUNT_USED = 'xConnectReportDiscountUsed';

// 10% off once, offered to users who connect X. Applies to the first subscription month
// and, separately, to the first one-time report purchase.
const X_CONNECT_COUPON_ID = 'x-connect-10-percent';

export type ReplyCorpEventType = 'signup' | 'purchase';

/**
 * Commission paid on each purchase, as a percent of the amount paid (REPLYCORP_COMMISSION_PERCENT).
 * Unset or invalid means 0, which records attribution without creating any charge or rewards.
 */
function commissionFor(amount: number) {
  const percent = Number(process.env.REPLYCORP_COMMISSION_PERCENT);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  // Round down to the cent, and never exceed the sale amount, which the API rejects
  return Math.min(amount, Math.floor(amount * percent) / 100);
}

export function isReplyCorpConfigured() {
  return !!(process.env.REPLYCORP_API_KEY && process.env.REPLYCORP_CAMPAIGN_ID);
}

/**
 * Posts a conversion to ReplyCorp. Never throws, because tracking must not break payments.
 * transactionHash makes retries idempotent within the campaign.
 */
export async function reportReplyCorpConversion(params: {
  twitterId: string;
  eventType: ReplyCorpEventType;
  amount?: number;
  transactionHash: string;
}): Promise<{ ok: boolean; conversionId?: string; error?: string }> {
  if (!isReplyCorpConfigured()) {
    return { ok: false, error: 'ReplyCorp is not configured' };
  }

  const body: Record<string, unknown> = {
    twitterId: params.twitterId,
    eventType: params.eventType,
    transactionHash: params.transactionHash,
  };
  if (params.eventType === 'purchase') {
    body.amount = params.amount;
    body.commission = commissionFor(params.amount ?? 0);
  }

  try {
    const response = await fetch(
      `${REPLYCORP_API_BASE}/campaigns/${process.env.REPLYCORP_CAMPAIGN_ID}/conversions`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': process.env.REPLYCORP_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[ReplyCorp] Conversion rejected:', response.status, data);
      return { ok: false, error: `HTTP ${response.status}` };
    }

    console.log(`[ReplyCorp] Recorded ${params.eventType} conversion ${data.conversion?.id}${data.idempotentReplay ? ' (replay)' : ''}`);
    return { ok: true, conversionId: data.conversion?.id };
  } catch (error) {
    console.error('[ReplyCorp] Conversion request failed:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Request failed' };
  }
}

/**
 * Returns the id of the 10% X-connect coupon, creating it in Stripe on first use.
 */
export async function getXConnectCouponId(stripe: Stripe): Promise<string> {
  try {
    await stripe.coupons.retrieve(X_CONNECT_COUPON_ID);
  } catch (error: any) {
    if (error?.code !== 'resource_missing') throw error;
    await stripe.coupons.create({
      id: X_CONNECT_COUPON_ID,
      name: '10% off for connecting X',
      percent_off: 10,
      duration: 'once',
    });
    console.log(`[ReplyCorp] Created Stripe coupon ${X_CONNECT_COUPON_ID}`);
  }
  return X_CONNECT_COUPON_ID;
}

export function hasConnectedX(customer: Stripe.Customer) {
  return !!customer.metadata?.[METADATA_TWITTER_ID];
}
