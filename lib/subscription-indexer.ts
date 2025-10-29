/**
 * Subscription verification using Alchemy's indexer API
 * Queries blockchain for transactions from user wallet to payment wallet
 * Calculates subscription status without database
 */

import { Alchemy, Network, AssetTransfersCategory } from 'alchemy-sdk';
import { convertToUsd } from './coingecko';

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
  amount: number; // Token amount (ETH or USDC)
  currency: 'ETH' | 'USDC';
  usdValue: number;
  daysPurchased: number;
  chain: string;
}

const MONTHLY_PRICE = 4.99; // USD
const DAYS_PER_MONTH = 30;

// Network configurations for Alchemy
const NETWORKS: Record<string, Network> = {
  ethereum: Network.ETH_MAINNET,
  base: Network.BASE_MAINNET,
  arbitrum: Network.ARB_MAINNET,
  optimism: Network.OPT_MAINNET,
};

// USDC contract addresses for each chain
const USDC_CONTRACTS: Record<string, string> = {
  ethereum: process.env.USDC_CONTRACT_ETHEREUM || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: process.env.USDC_CONTRACT_BASE || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  arbitrum: process.env.USDC_CONTRACT_ARBITRUM || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  optimism: process.env.USDC_CONTRACT_OPTIMISM || '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
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

  const payments: PaymentRecord[] = [];

  // Query all supported chains
  for (const [chainName, network] of Object.entries(NETWORKS)) {
    try {
      const alchemy = new Alchemy({
        apiKey: process.env.ALCHEMY_API_KEY,
        network,
      });

      // Get ETH transfers
      const ethTransfers = await alchemy.core.getAssetTransfers({
        fromAddress: walletAddress,
        toAddress: paymentWallet,
        category: [AssetTransfersCategory.EXTERNAL],
        order: 'asc',
      });

      // Get USDC transfers
      const usdcTransfers = await alchemy.core.getAssetTransfers({
        fromAddress: walletAddress,
        toAddress: paymentWallet,
        category: [AssetTransfersCategory.ERC20],
        contractAddresses: [USDC_CONTRACTS[chainName]],
        order: 'asc',
      });

      // Process ETH transfers
      for (const transfer of ethTransfers.transfers) {
        if (!transfer.value || transfer.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(transfer.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD
        const usdValue = await convertToUsd(transfer.value, 'ETH', timestamp);

        // Skip payments under $1
        if (usdValue < 1) continue;

        // Calculate days purchased
        const daysPurchased = (usdValue / MONTHLY_PRICE) * DAYS_PER_MONTH;

        payments.push({
          transactionHash: transfer.hash,
          timestamp,
          amount: transfer.value,
          currency: 'ETH',
          usdValue,
          daysPurchased,
          chain: chainName,
        });
      }

      // Process USDC transfers
      for (const transfer of usdcTransfers.transfers) {
        if (!transfer.value || transfer.value === 0) continue;

        // Get block timestamp
        const block = await alchemy.core.getBlock(transfer.blockNum);
        const timestamp = block.timestamp;

        // Convert to USD (USDC uses 6 decimals, not 18)
        const usdValue = await convertToUsd(transfer.value, 'USDC', timestamp);

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
        });
      }
    } catch (error) {
      console.error(`Error querying ${chainName}:`, error);
      // Continue checking other chains even if one fails
    }
  }

  // Sort payments by timestamp
  payments.sort((a, b) => a.timestamp - b.timestamp);

  // Calculate subscription status
  if (payments.length === 0) {
    return {
      isActive: false,
      expiresAt: null,
      daysRemaining: 0,
      totalDaysPurchased: 0,
      totalPaid: 0,
      payments: [],
    };
  }

  // Calculate total days purchased
  const totalDaysPurchased = payments.reduce((sum, p) => sum + p.daysPurchased, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.usdValue, 0);

  // Calculate expiration date (from first payment)
  const firstPaymentTime = payments[0].timestamp * 1000; // Convert to milliseconds
  const totalMilliseconds = totalDaysPurchased * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(firstPaymentTime + totalMilliseconds);

  // Check if subscription is active
  const now = Date.now();
  const isActive = now < expiresAt.getTime();
  const daysRemaining = isActive
    ? Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))
    : 0;

  return {
    isActive,
    expiresAt,
    daysRemaining,
    totalDaysPurchased: Math.floor(totalDaysPurchased),
    totalPaid,
    payments,
  };
}
