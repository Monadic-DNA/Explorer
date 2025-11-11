# Stripe Integration Documentation

## Overview

Stripe integration uses **direct API queries** to check subscription status, similar to how blockchain payments are verified via Alchemy API. This approach eliminates the need for webhooks, database storage, and complex synchronization logic.

## Architecture

```
User subscribes → Stripe manages subscription → App queries Stripe API → Verify active subscription
```

**Key Benefits:**
- ✅ No webhooks to configure or debug
- ✅ No database tables for payment storage
- ✅ Always up-to-date (Stripe is source of truth)
- ✅ Consistent with blockchain payment verification
- ✅ Simple and reliable

## Environment Variables

Add these to `.env.local`:

```bash
# Stripe API Keys
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here

# Stripe Product Configuration
STRIPE_PRICE_ID=price_your_recurring_price_id_here

# Note: STRIPE_WEBHOOK_SECRET is NOT needed for direct query approach
```

## How It Works

### 1. Subscription Creation Flow

When a user subscribes:

1. User logs in with wallet (Dynamic.xyz)
2. Frontend calls `/api/stripe/create-subscription` with `walletAddress`
3. Backend creates Stripe customer with `walletAddress` in metadata
4. Backend creates Stripe subscription with `walletAddress` in metadata
5. Frontend shows Stripe Payment Element for user to complete payment
6. Stripe handles recurring billing automatically

**File:** `app/api/stripe/create-subscription/route.ts`

### 2. Subscription Verification Flow

When checking if user has access:

1. User logs in with wallet
2. Frontend calls `/api/check-subscription` with `walletAddress`
3. Backend queries Stripe API: Search for customers with matching `walletAddress` in metadata
4. Backend checks if customer has active subscription
5. Returns subscription status (active/inactive, expiration date, days remaining)

**Files:**
- `lib/subscription-manager.ts` - `checkStripeSubscription()`
- `app/api/check-subscription/route.ts` - API endpoint

### 3. Combined Subscription Check

The app supports both Stripe (card) and blockchain (crypto) payments:

```typescript
// Queries both Stripe API and Alchemy API in parallel
const subscription = await checkCombinedSubscription(walletAddress);

// Returns whichever subscription expires latest
// User has access if EITHER subscription is active
```

**File:** `lib/subscription-manager.ts` - `checkCombinedSubscription()`

## API Endpoints

### Create Subscription

**POST** `/api/stripe/create-subscription`

```bash
curl -X POST http://localhost:3000/api/stripe/create-subscription \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x1234..."}'
```

**Response:**
```json
{
  "success": true,
  "subscriptionId": "sub_...",
  "clientSecret": "pi_..._secret_..."
}
```

### Check Subscription

**POST** `/api/check-subscription`

```bash
curl -X POST http://localhost:3000/api/check-subscription \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x1234..."}'
```

**Response:**
```json
{
  "success": true,
  "subscription": {
    "isActive": true,
    "expiresAt": "2025-12-15T00:00:00.000Z",
    "daysRemaining": 30,
    "totalDaysPurchased": 30,
    "totalPaid": 4.99,
    "paymentCount": 1
  }
}
```

## Code Structure

### Frontend Components

**Payment Modal** - `app/components/PaymentModal.tsx`
- Shows subscription options (crypto vs card)
- Handles Stripe subscription creation
- Displays Stripe Payment Element

**Stripe Form** - `app/components/StripeSubscriptionForm.tsx`
- Loads Stripe.js
- Renders Payment Element
- Handles payment confirmation

**Auth Provider** - `app/components/AuthProvider.tsx`
- Checks subscription status on login
- Caches subscription status for 1 hour
- Provides `hasActiveSubscription` to components

### Backend Logic

**Subscription Manager** - `lib/subscription-manager.ts`
- `checkStripeSubscription()` - Queries Stripe API directly
- `checkCombinedSubscription()` - Merges Stripe + blockchain payments

**API Routes:**
- `app/api/stripe/create-subscription/route.ts` - Creates subscription
- `app/api/check-subscription/route.ts` - Verifies subscription status

## Testing

### Local Development

1. Use Stripe test mode keys:
   ```bash
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

2. Test card numbers:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - Requires authentication: `4000 0025 0000 3155`

3. Any future expiry date and CVC will work

### Testing Subscription Flow

1. Start dev server: `npm run dev`
2. Log in with wallet
3. Click "Subscribe to Premium"
4. Choose "Pay with Card"
5. Enter test card: `4242 4242 4242 4242`
6. Complete payment
7. Verify subscription shows as active

### Testing API Directly

```bash
# Check subscription status
curl -X POST http://localhost:3000/api/check-subscription \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "YOUR_WALLET_ADDRESS"}'
```

## Stripe Dashboard

### Create Price

1. Go to https://dashboard.stripe.com/test/products
2. Click "Add product"
3. Name: "Premium Subscription"
4. Price: $4.99
5. Billing period: Monthly
6. Click "Save product"
7. Copy the Price ID (starts with `price_...`)
8. Add to `.env.local` as `STRIPE_PRICE_ID`

### View Subscriptions

1. Go to https://dashboard.stripe.com/test/subscriptions
2. Click a subscription to view details
3. Check "Metadata" tab for `walletAddress`

### View Customers

1. Go to https://dashboard.stripe.com/test/customers
2. Click a customer to view details
3. Check "Metadata" tab for `walletAddress`

## Rate Limits

Stripe API rate limits:
- **Test mode:** 100 requests/second
- **Live mode:** 100 requests/second

Subscription checks are cached for 1 hour in localStorage, so rate limits are rarely reached.

## Production Deployment

### Pre-deployment Checklist

- [ ] Switch to **live** Stripe keys (not test keys)
- [ ] Update `STRIPE_SECRET_KEY` in production environment
- [ ] Update `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in production environment
- [ ] Update `STRIPE_PRICE_ID` to use live price (not test price)
- [ ] Test subscription creation in production
- [ ] Test subscription verification in production
- [ ] Verify recurring billing works correctly

### Environment Variables

Production `.env.local`:
```bash
# Use LIVE keys
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_PRICE_ID=price_... # Must be from live mode
```

## Security

### Wallet Address Association

- Wallet addresses are stored in Stripe customer and subscription metadata
- Addresses are normalized to lowercase for consistency
- No blockchain transactions required for card payments
- User proves wallet ownership via Dynamic.xyz authentication

### API Keys

- `STRIPE_SECRET_KEY` must NEVER be exposed to client
- Only used in server-side API routes
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is safe to expose (by design)

### Subscription Verification

- Subscription status queried directly from Stripe
- Cannot be spoofed or manipulated client-side
- User must prove wallet ownership to access subscription benefits

## Troubleshooting

### "No active subscription found"

**Possible causes:**
1. Subscription not created yet
2. Subscription cancelled or expired
3. Payment failed
4. Wrong wallet address

**Debug:**
```bash
# Check Stripe for subscriptions with this wallet address
# Dashboard → Customers → Search metadata for walletAddress
```

### "Failed to check Stripe subscription"

**Possible causes:**
1. `STRIPE_SECRET_KEY` not configured
2. Stripe API error
3. Network timeout

**Debug:**
Check server console logs for detailed error message

### Multiple subscriptions for same wallet

This is supported! The system uses the subscription with the **latest expiration date**.

### Subscription not recognized immediately after payment

Try:
1. Clear localStorage cache: `localStorage.removeItem('subscription_YOUR_ADDRESS')`
2. Refresh the page
3. Wait a few seconds for Stripe to update

## Comparison with Blockchain Payments

| Feature | Stripe (Card) | Blockchain (Crypto) |
|---------|--------------|---------------------|
| **Verification** | Direct Stripe API | Alchemy API indexer |
| **Storage** | Stripe manages | No storage needed |
| **Latency** | ~200-500ms | ~500-1000ms |
| **Rate limits** | 100 req/s | 660 compute units/s |
| **Caching** | 1 hour | 1 hour |
| **Recurring** | Yes (automatic) | No (manual top-ups) |
| **Refunds** | Via Stripe Dashboard | Cannot refund blockchain tx |

## Migration from Webhook Approach

If you previously used webhooks + database:

1. Remove old data:
   ```sql
   DROP TABLE IF EXISTS stripe_payments;
   ```

2. Environment variables to remove:
   - `STRIPE_WEBHOOK_SECRET` (no longer needed)
   - `POSTGRES_DB` (no longer required for Stripe payments)

3. Existing subscriptions will continue to work automatically via direct API queries

## Support

For Stripe integration issues:
1. Check Stripe Dashboard logs
2. Check server console for error messages
3. Verify environment variables are set correctly
4. Review Stripe API documentation: https://stripe.com/docs/api
