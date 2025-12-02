# Stablecoin Payment System (EVM Chains)

## Overview

GWASifier Premium now uses a **database-free, stablecoin-based payment system**. Users pay with stablecoins (USDC, USDT, or DAI) from their connected wallet, and subscription status is verified on-chain using Alchemy's indexer API.

## How It Works

### User Flow
1. User connects wallet via Dynamic.xyz
2. User navigates to Premium tab
3. User selects stablecoin (USDC, USDT, or DAI) and sends payment to payment wallet
4. After blockchain confirmation (~1-2 minutes), subscription activates automatically
5. Subscription status is cached in localStorage for 1 hour

### Technical Architecture

```
┌─────────────┐
│   User      │ Connects wallet (Dynamic.xyz)
│   Wallet    │ Sends stablecoin (USDC/USDT/DAI) to payment wallet
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Blockchain  │ Ethereum, Base, Arbitrum, Optimism, Polygon
│ Transaction │ Stablecoin transfer
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Alchemy   │ Indexer API queries transaction history
│   Indexer   │ getAssetTransfers(from: userWallet, to: paymentWallet)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│Subscription │ Calculate total days purchased
│ Calculator  │ days = (amountUSD / $4.99) * 30
│             │ (stablecoins assumed 1:1 with USD)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ localStorage│ Cache subscription status for 1 hour
│   Cache     │ Reduce API calls by 80%+
└─────────────┘
```

## Setup Instructions

### 1. Environment Variables

Copy `.env.local.example` to `.env.local` and configure:

```bash
# Required: Alchemy API key (free tier: 300M compute units/month)
ALCHEMY_API_KEY=your_alchemy_api_key

# Required: Payment wallet address (same across all chains)
# NEXT_PUBLIC_ prefix needed because it's displayed in the browser UI
NEXT_PUBLIC_# NEXT_PUBLIC_ prefix needed because it's displayed in the browser UI

# Optional: Alchemy Prices API Pro API key (free tier usually sufficient)
# COINGECKO_API_KEY=your_alchemy-prices_pro_api_key

# Optional: Cache duration in hours (default: 1)
NEXT_PUBLIC_SUBSCRIPTION_CACHE_HOURS=1

# Required: Dynamic.xyz for wallet connection
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=your_dynamic_environment_id
```

### 2. Supported Chains

The system supports 5 EVM chains (production):
- **Ethereum**
- **Base**
- **Arbitrum**
- **Optimism**
- **Polygon**

The system also supports **Sepolia testnet** when explicitly enabled:
- **Sepolia** (Ethereum testnet) - Enable by setting `NEXT_PUBLIC_ENABLE_TESTNET_CHAINS=true` in `.env.local`

**USDC**, **USDT**, and **DAI** are accepted on all chains.

### 3. Pricing Model

```
Payment Amount (USD) = Subscription Days
-------------------------------------------
$4.99                = 30 days (1 month)
$9.98                = 60 days (2 months)
$2.50                = 15 days (~2 weeks)
$10.00               = 60 days (2 months)
$1.00                = 6 days (minimum)
```

Formula: `days = (amountUSD / 4.99) * 30`

Payments are cumulative - users can top up anytime.

## API Endpoints

### Check Subscription Status

**POST** `/api/check-subscription`

Request:
```json
{
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

Response:
```json
{
  "success": true,
  "subscription": {
    "isActive": true,
    "expiresAt": "2025-02-15T10:30:00.000Z",
    "daysRemaining": 45,
    "totalDaysPurchased": 60,
    "totalPaid": 9.98,
    "paymentCount": 2
  }
}
```

## Caching Strategy

### localStorage Cache
- **Key**: `subscription_{walletAddress}`
- **Duration**: 1 hour (configurable via `NEXT_PUBLIC_SUBSCRIPTION_CACHE_HOURS`)
- **Cache hit rate**: ~80-90% (users don't refresh constantly)

### In-Memory Price Cache
- **Alchemy Prices API historical prices** are cached in memory for 24 hours
- Prices don't change after the fact, so cache can be long-lived
- Reduces Alchemy Prices API API calls by ~95%

### Performance
- **Cache hit**: <1ms (localStorage read)
- **Cache miss**: 2-5 seconds (Alchemy + Alchemy Prices API API calls)
- **Average**: <100ms (with 80% cache hit rate)

## API Rate Limits & Costs

### Free Tier (Sufficient for Initial Launch)

| Service | Free Tier | Usage Pattern | Sufficient For |
|---------|-----------|---------------|----------------|
| **Alchemy** | 300M compute units/month | ~2-5 CU per subscription check | ~5,000 daily active users |
| **Alchemy Prices API** | 10-30 calls/minute | ~0.5 calls per new payment | ~20k payments/month |

### Upgrade Path

**Alchemy Growth ($49/mo)**
- 1.5B compute units/month
- Handles ~25,000 daily active users

**Alchemy Prices API Pro ($129/mo)**
- 500 calls/minute
- Only needed if processing >100k payments/month

## Benefits Over Database Approach

1. **No infrastructure costs** - No PostgreSQL hosting fees
2. **No maintenance** - No database backups, migrations, or scaling
3. **Zero personal data** - No GDPR/privacy concerns
4. **Transparent** - All subscription data verifiable on-chain
5. **Stateless** - Easy to scale horizontally
6. **Simpler codebase** - ~1,000 lines of code removed
7. **No price volatility** - Stablecoins maintain 1:1 USD peg

## Security Considerations

### What's Secure
- ✅ Payment wallet is view-only (users can verify balance)
- ✅ Subscription calculation is deterministic (same for all nodes)
- ✅ No personal data stored (just wallet addresses)
- ✅ localStorage cache can't be exploited (backend verifies on API calls)

### What to Monitor
- 🔍 Watch payment wallet balance and withdraw regularly
- 🔍 Monitor Alchemy API usage to avoid rate limits
- 🔍 Set up alerts for unusual payment patterns

## Troubleshooting

### Subscription not activating after payment

1. **Check transaction confirmed**: View on block explorer (Etherscan, Basescan, etc.)
2. **Verify payment amount**: Minimum $1 USD
3. **Verify sender wallet**: Must match connected wallet in app
4. **Clear localStorage cache**: Force refresh with `localStorage.removeItem('subscription_...')`
5. **Check Alchemy API key**: Ensure valid and not rate-limited

### "Failed to check subscription" error

1. **Check API keys**: Alchemy API key must be valid
2. **Check wallet address format**: Must be valid EVM address (0x...)
3. **Check network connectivity**: API calls may be timing out
4. **Check browser console**: Look for specific error messages

### Cache not updating after payment

- **Solution**: Call `refreshSubscription()` from AuthProvider
- **Alternative**: Wait 1 hour for automatic cache expiration
- **Manual**: Clear localStorage: `localStorage.clear()`

## Testing

### Testnet Testing (Recommended)

**Enable Sepolia testnet by adding this to your `.env.local` file:**
```bash
NEXT_PUBLIC_ENABLE_TESTNET_CHAINS=true
```

Then restart your development server (`npm run dev`).

1. **Get testnet ETH for gas fees:**
   - [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
   - [Infura Sepolia Faucet](https://www.infura.io/faucet/sepolia)

2. **Get testnet stablecoins:**
   - **USDC (Sepolia)**: [Circle Testnet Faucet](https://faucet.circle.com/) - Use address `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
   - **USDT (Sepolia)**: Deploy your own or use testnet faucet at `0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0`
   - **DAI (Sepolia)**: [MakerDAO Testnet Faucet](https://app.spark.fi/faucet/) - Use address `0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357`

3. **Configure payment wallet:**
   - Set `NEXT_PUBLIC_EVM_PAYMENT_WALLET_ADDRESS` in `.env.local` to your test wallet address
   - This is where testnet payments will be sent

4. **Switch wallet to Sepolia network:**
   - Connect wallet via Dynamic.xyz
   - Switch to Sepolia network in your wallet
   - The UI will show "🧪 TESTNET" indicator when connected to Sepolia

5. **Send test transaction:**
   - Choose amount (e.g., $1 USD = 1 USDC)
   - Select stablecoin (USDC, USDT, or DAI)
   - Confirm transaction in wallet

6. **Verify subscription activates:**
   - Wait ~30 seconds for transaction confirmation
   - Refresh page to check subscription status

### Mainnet Testing (Small Amount)

1. Send $1 worth of USDC, USDT, or DAI from connected wallet
2. Wait ~2 minutes for blockchain confirmation
3. Refresh page to check subscription status
4. Verify 6 days added to subscription

## Migration from Old System

If you were using the old Paddle + Database system:

1. **No data migration needed** - Old subscriptions won't transfer
2. **Remove database**: Drop payment tables (`users`, `subscriptions`, `payments`, `webhook_events`)
3. **Remove environment variables**: Remove all `PADDLE_*` and `POSTGRES_URL` (payment-related)
4. **Deploy new code**: The system is now 100% blockchain-based

## Future Enhancements

Potential improvements:
- [ ] Add email notifications when subscription expires
- [ ] Add QR code for mobile wallet payments
- [ ] Support more chains (Polygon, Avalanche, etc.)
- [ ] Add token price charts in UI
- [ ] Add refund mechanism (for accidental overpayments)

## Support

For payment issues:
- Check blockchain explorer for transaction status
- Verify payment wallet address is correct
- Contact support with transaction hash

For technical issues:
- Check browser console for errors
- Verify API keys are configured
- Review server logs for detailed error messages
