/**
 * Stablecoin pricing for payment verification
 * All stablecoins are assumed to be pegged 1:1 with USD
 */

import { Network } from 'alchemy-sdk';

/**
 * Get price for a stablecoin (always $1)
 *
 * @param symbol - Token symbol ('USDC', 'USDT', or 'DAI')
 * @param timestamp - Unix timestamp in seconds (unused, for compatibility)
 * @param network - Blockchain network (unused, for compatibility)
 * @returns Price in USD (always 1.0)
 */
export async function getHistoricalPrice(
  symbol: 'USDC' | 'USDT' | 'DAI',
  timestamp: number,
  network: Network
): Promise<number> {
  // All stablecoins are pegged to $1
  return 1.0;
}


/**
 * Convert stablecoin amount to USD
 * Since all stablecoins are pegged 1:1 with USD, this is a simple passthrough
 *
 * @param amount - Amount in tokens (USDC, USDT, or DAI)
 * @param currency - Currency type ('USDC', 'USDT', or 'DAI')
 * @param timestamp - Unix timestamp in seconds (unused, for compatibility)
 * @param network - Blockchain network (unused, for compatibility)
 * @returns USD value (same as amount since 1 stablecoin = $1)
 */
export async function convertToUsd(
  amount: number,
  currency: 'USDC' | 'USDT' | 'DAI',
  timestamp: number,
  network: Network
): Promise<number> {
  // All stablecoins are 1:1 with USD
  return amount;
}
