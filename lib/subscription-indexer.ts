/**
 * Subscription verification using Alchemy's indexer API
 * Queries blockchain for transactions from user wallet to payment wallet
 * Calculates subscription status without database
 */

// CRITICAL: Import fetch polyfill FIRST before any other imports
import './fetch-polyfill';

import { Alchemy, Network, AssetTransfersCategory, SortingOrder } from 'alchemy-sdk';
import { convertToUsd } from './alchemy-prices';

export interface SubscriptionStatus {
  isActive: boolean;
  expiresAt: Date | null;
  daysRemaining: number;
  totalDaysPurchased: number;
  totalPaid: number; // Total USD paid
  payments: PaymentRecord[];
}

export interface PaymentRecord {
  transactionHash: string;
  timestamp: number;
  amount: number; // Token amount (stablecoin or USD for Stripe)
  currency: 'USDC' | 'USDT' | 'DAI' | 'USD';
  usdValue: number;
  daysPurchased: number; // Positive for payments, negative for refunds
  chain: string;
  type: 'payment' | 'refund';
}

const MONTHLY_PRICE = 4.99; // USD
const DAYS_PER_MONTH = 30;

// Check if testnet chains are enabled
const TESTNET_ENABLED = process.env.NEXT_PUBLIC_ENABLE_TESTNET_CHAINS === 'true';

// Network configurations for Alchemy
const NETWORKS: Record<string, Network> = {
  ethereum: Network.ETH_MAINNET,
  base: Network.BASE_MAINNET,
  arbitrum: Network.ARB_MAINNET,
  optimism: Network.OPT_MAINNET,
  polygon: Network.MATIC_MAINNET,
  ...(TESTNET_ENABLED ? {
    sepolia: Network.ETH_SEPOLIA,
  } : {}),
};

// USDC contract addresses for each chain
const USDC_CONTRACTS: Record<string, string> = {
  ethereum: process.env.USDC_CONTRACT_ETHEREUM || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: process.env.USDC_CONTRACT_BASE || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  arbitrum: process.env.USDC_CONTRACT_ARBITRUM || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  optimism: process.env.USDC_CONTRACT_OPTIMISM || '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  polygon: process.env.USDC_CONTRACT_POLYGON || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  ...(TESTNET_ENABLED ? {
    sepolia: process.env.USDC_CONTRACT_SEPOLIA || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  } : {}),
};

// USDT contract addresses for each chain
const USDT_CONTRACTS: Record<string, string> = {
  ethereum: process.env.USDT_CONTRACT_ETHEREUM || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  base: process.env.USDT_CONTRACT_BASE || '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  arbitrum: process.env.USDT_CONTRACT_ARBITRUM || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  optimism: process.env.USDT_CONTRACT_OPTIMISM || '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  polygon: process.env.USDT_CONTRACT_POLYGON || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  ...(TESTNET_ENABLED ? {
    sepolia: process.env.USDT_CONTRACT_SEPOLIA || '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
  } : {}),
};

// DAI contract addresses for each chain
const DAI_CONTRACTS: Record<string, string> = {
  ethereum: process.env.DAI_CONTRACT_ETHEREUM || '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  base: process.env.DAI_CONTRACT_BASE || '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  arbitrum: process.env.DAI_CONTRACT_ARBITRUM || '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  optimism: process.env.DAI_CONTRACT_OPTIMISM || '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  polygon: process.env.DAI_CONTRACT_POLYGON || '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  ...(TESTNET_ENABLED ? {
    sepolia: process.env.DAI_CONTRACT_SEPOLIA || '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357',
  } : {}),
};

/**
 * Check subscription status for a wallet address
 * @param walletAddress - User's wallet address
 * @returns Subscription status
 */
export async function checkSubscription(walletAddress: string): Promise<SubscriptionStatus> {
  const paymentWallet = process.env.NEXT_PUBLIC_EVM_PAYMENT_WALLET_ADDRESS;

  if (!paymentWallet) {
    throw new Error('NEXT_PUBLIC_EVM_PAYMENT_WALLET_ADDRESS environment variable not set');
  }

  if (!process.env.ALCHEMY_API_KEY) {
    throw new Error('ALCHEMY_API_KEY environment variable not set');
  }

  console.log('[Subscription Indexer] Starting subscription check for wallet:', walletAddress);
  console.log('[Subscription Indexer] Payment wallet:', paymentWallet);
  console.log('[Subscription Indexer] Testnet enabled:', TESTNET_ENABLED);
  console.log('[Subscription Indexer] Chains to query:', Object.keys(NETWORKS));

  const payments: PaymentRecord[] = [];

  // Query all supported chains
  for (const [chainName, network] of Object.entries(NETWORKS)) {
    console.log(`\n[Subscription Indexer] Querying chain: ${chainName}`);
    try {
      const alchemy = new Alchemy({
        apiKey: process.env.ALCHEMY_API_KEY!,
        network,
      });

      // Get USDC payments (from user to payment wallet)
      const usdcTransfers = await alchemy.core.getAssetTransfers({
        fromAddress: walletAddress,
        toAddress: paymentWallet,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [USDC_CONTRACTS[chainName]],
        order: SortingOrder.ASCENDING,
      });
      console.log(`[Subscription Indexer] USDC payments ${usdcTransfers.transfers.length > 0 ? 'found' : 'not found'} on chain ${chainName} (${usdcTransfers.transfers.length} transfers)`);

      // Get USDC refunds (from payment wallet to user)
      const usdcRefunds = await alchemy.core.getAssetTransfers({
        fromAddress: paymentWallet,
        toAddress: walletAddress,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [USDC_CONTRACTS[chainName]],
        order: SortingOrder.ASCENDING,
      });
      console.log(`[Subscription Indexer] USDC refunds ${usdcRefunds.transfers.length > 0 ? 'found' : 'not found'} on chain ${chainName} (${usdcRefunds.transfers.length} transfers)`);

      // Get USDT payments (from user to payment wallet)
      const usdtTransfers = await alchemy.core.getAssetTransfers({
        fromAddress: walletAddress,
        toAddress: paymentWallet,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [USDT_CONTRACTS[chainName]],
        order: SortingOrder.ASCENDING,
      });
      console.log(`[Subscription Indexer] USDT payments ${usdtTransfers.transfers.length > 0 ? 'found' : 'not found'} on chain ${chainName} (${usdtTransfers.transfers.length} transfers)`);

      // Get USDT refunds (from payment wallet to user)
      const usdtRefunds = await alchemy.core.getAssetTransfers({
        fromAddress: paymentWallet,
        toAddress: walletAddress,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [USDT_CONTRACTS[chainName]],
        order: SortingOrder.ASCENDING,
      });
      console.log(`[Subscription Indexer] USDT refunds ${usdtRefunds.transfers.length > 0 ? 'found' : 'not found'} on chain ${chainName} (${usdtRefunds.transfers.length} transfers)`);

      // Get DAI payments (from user to payment wallet)
      const daiTransfers = await alchemy.core.getAssetTransfers({
        fromAddress: walletAddress,
        toAddress: paymentWallet,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [DAI_CONTRACTS[chainName]],
        order: SortingOrder.ASCENDING,
      });
      console.log(`[Subscription Indexer] DAI payments ${daiTransfers.transfers.length > 0 ? 'found' : 'not found'} on chain ${chainName} (${daiTransfers.transfers.length} transfers)`);

      // Get DAI refunds (from payment wallet to user)
      const daiRefunds = await alchemy.core.getAssetTransfers({
        fromAddress: paymentWallet,
        toAddress: walletAddress,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [DAI_CONTRACTS[chainName]],
        order: SortingOrder.ASCENDING,
      });
      console.log(`[Subscription Indexer] DAI refunds ${daiRefunds.transfers.length > 0 ? 'found' : 'not found'} on chain ${chainName} (${daiRefunds.transfers.length} transfers)`);

      // Process USDC payments
      for (const transfer of usdcTransfers.transfers) {
        if (!transfer.value || transfer.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(transfer.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (USDC = $1, uses 6 decimals)
        const usdValue = await convertToUsd(transfer.value, 'USDC', timestamp, network);

        // Skip payments under $1
        if (usdValue < 1) continue;

        // Calculate days purchased
        const daysPurchased = (usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH;

        payments.push({
          transactionHash: transfer.hash,
          timestamp,
          amount: transfer.value,
          currency: 'USDC',
          usdValue,
          daysPurchased,
          chain: chainName,
          type: 'payment',
        });
      }

      // Process USDC refunds
      for (const refund of usdcRefunds.transfers) {
        if (!refund.value || refund.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(refund.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (USDC = $1, uses 6 decimals)
        const usdValue = await convertToUsd(refund.value, 'USDC', timestamp, network);

        // Skip refunds under $1
        if (usdValue < 1) continue;

        // Calculate days deducted (negative)
        const daysPurchased = -((usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH);

        payments.push({
          transactionHash: refund.hash,
          timestamp,
          amount: refund.value,
          currency: 'USDC',
          usdValue,
          daysPurchased, // Negative value
          chain: chainName,
          type: 'refund',
        });
      }

      // Process USDT payments
      for (const transfer of usdtTransfers.transfers) {
        if (!transfer.value || transfer.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(transfer.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (USDT = $1, uses 6 decimals)
        const usdValue = await convertToUsd(transfer.value, 'USDT', timestamp, network);

        // Skip payments under $1
        if (usdValue < 1) continue;

        // Calculate days purchased
        const daysPurchased = (usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH;

        payments.push({
          transactionHash: transfer.hash,
          timestamp,
          amount: transfer.value,
          currency: 'USDT',
          usdValue,
          daysPurchased,
          chain: chainName,
          type: 'payment',
        });
      }

      // Process USDT refunds
      for (const refund of usdtRefunds.transfers) {
        if (!refund.value || refund.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(refund.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (USDT = $1, uses 6 decimals)
        const usdValue = await convertToUsd(refund.value, 'USDT', timestamp, network);

        // Skip refunds under $1
        if (usdValue < 1) continue;

        // Calculate days deducted (negative)
        const daysPurchased = -((usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH);

        payments.push({
          transactionHash: refund.hash,
          timestamp,
          amount: refund.value,
          currency: 'USDT',
          usdValue,
          daysPurchased, // Negative value
          chain: chainName,
          type: 'refund',
        });
      }

      // Process DAI payments
      for (const transfer of daiTransfers.transfers) {
        if (!transfer.value || transfer.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(transfer.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (DAI = $1, uses 18 decimals)
        const usdValue = await convertToUsd(transfer.value, 'DAI', timestamp, network);

        // Skip payments under $1
        if (usdValue < 1) continue;

        // Calculate days purchased
        const daysPurchased = (usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH;

        payments.push({
          transactionHash: transfer.hash,
          timestamp,
          amount: transfer.value,
          currency: 'DAI',
          usdValue,
          daysPurchased,
          chain: chainName,
          type: 'payment',
        });
      }

      // Process DAI refunds
      for (const refund of daiRefunds.transfers) {
        if (!refund.value || refund.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(refund.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (DAI = $1, uses 18 decimals)
        const usdValue = await convertToUsd(refund.value, 'DAI', timestamp, network);

        // Skip refunds under $1
        if (usdValue < 1) continue;

        // Calculate days deducted (negative)
        const daysPurchased = -((usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH);

        payments.push({
          transactionHash: refund.hash,
          timestamp,
          amount: refund.value,
          currency: 'DAI',
          usdValue,
          daysPurchased, // Negative value
          chain: chainName,
          type: 'refund',
        });
      }
    } catch (error) {
      console.error(`Error querying ${chainName}:`, error);
      // Continue checking other chains even if one fails
    }
  }

  // Sort payments and refunds by timestamp
  payments.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`\n[Subscription Indexer] =================================`);
  console.log(`[Subscription Indexer] Total payments found: ${payments.length}`);
  if (payments.length > 0) {
    console.log(`[Subscription Indexer] Payment details:`);
    payments.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.type.toUpperCase()} - ${p.currency} on ${p.chain}: ${p.usdValue} USD (${p.daysPurchased} days) - TX: ${p.transactionHash.slice(0, 10)}...`);
    });
  }
  console.log(`[Subscription Indexer] =================================\n`);

  // Calculate subscription status
  if (payments.length === 0) {
    console.log('[Subscription Indexer] No payments found - subscription inactive');
    return {
      isActive: false,
      expiresAt: null,
      daysRemaining: 0,
      totalDaysPurchased: 0,
      totalPaid: 0,
      payments: [],
    };
  }

  // Calculate net days purchased (payments are positive, refunds are negative)
  const totalDaysPurchased = payments.reduce((sum, p) => sum + p.daysPurchased, 0);

  // Calculate net amount paid (sum payments, subtract refunds)
  const totalPaid = payments.reduce((sum, p) => {
    return sum + (p.type === 'payment' ? p.usdValue : -p.usdValue);
  }, 0);

  // Calculate expiration date (from first transaction - payment or refund)
  // Net days purchased accounts for refunds automatically (negative daysPurchased)
  const firstPaymentTime = payments[0].timestamp * 1000; // Convert to milliseconds
  const totalMilliseconds = totalDaysPurchased * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(firstPaymentTime + totalMilliseconds);

  // Check if subscription is active
  const now = Date.now();
  const isActive = now < expiresAt.getTime();
  const daysRemaining = isActive
    ? Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))
    : 0;

  console.log('[Subscription Indexer] Subscription calculation complete:');
  console.log(`  - Total paid: $${totalPaid.toFixed(2)} USD`);
  console.log(`  - Total days purchased: ${Math.floor(totalDaysPurchased)}`);
  console.log(`  - Expires at: ${expiresAt.toISOString()}`);
  console.log(`  - Is active: ${isActive}`);
  console.log(`  - Days remaining: ${daysRemaining}`);

  return {
    isActive,
    expiresAt,
    daysRemaining,
    totalDaysPurchased: Math.floor(totalDaysPurchased),
    totalPaid,
    payments,
  };
}
