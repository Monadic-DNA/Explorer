/**
 * Alchemy Prices API integration for historical token prices (ETH, USDC)
 * Provides 5-minute granularity for accurate payment verification
 */

import { Alchemy, Network, HistoricalPriceInterval } from 'alchemy-sdk';

interface PriceCache {
  [key: string]: {
    price: number;
    timestamp: number;
  };
}

// In-memory cache for historical prices
const priceCache: PriceCache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (historical prices don't change)

/**
 * Get Alchemy instance for a specific network
 */
function getAlchemyInstance(network: Network): Alchemy {
  return new Alchemy({
    apiKey: process.env.ALCHEMY_API_KEY!,
    network,
  });
}

/**
 * Get historical price for a token at a specific timestamp
 * Uses 5-minute granularity for accurate pricing
 *
 * @param symbol - Token symbol ('ETH' or 'USDC')
 * @param timestamp - Unix timestamp in seconds
 * @param network - Blockchain network
 * @returns Price in USD
 */
export async function getHistoricalPrice(
  symbol: 'ETH' | 'USDC',
  timestamp: number,
  network: Network
): Promise<number> {
  // USDC is pegged to $1
  if (symbol === 'USDC') {
    return 1.0;
  }

  // Generate cache key
  const date = new Date(timestamp * 1000);
  const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const hourKey = date.getUTCHours();
  const cacheKey = `${symbol}_${network}_${dateKey}_${hourKey}`;

  // Check cache first
  const cached = priceCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  try {
    const alchemy = getAlchemyInstance(network);

    // Query 10-minute window around transaction time for best accuracy
    const startTime = timestamp - 300; // 5 min before
    const endTime = timestamp + 300;   // 5 min after

    const response = await alchemy.prices.getHistoricalPriceBySymbol(
      symbol,
      startTime,
      endTime,
      HistoricalPriceInterval.FIVE_MINUTE
    );

    if (!response.data || response.data.length === 0) {
      // Fallback to hourly if 5-minute data not available
      console.warn(`No 5-min data for ${symbol} at ${timestamp}, trying hourly...`);
      return getHistoricalPriceHourly(symbol, timestamp, network);
    }

    // Find the closest price data point to our transaction timestamp
    const closestDataPoint = response.data.reduce((prev, curr) => {
      const prevTime = new Date(prev.timestamp).getTime() / 1000;
      const currTime = new Date(curr.timestamp).getTime() / 1000;
      const prevDiff = Math.abs(prevTime - timestamp);
      const currDiff = Math.abs(currTime - timestamp);
      return currDiff < prevDiff ? curr : prev;
    });

    const price = parseFloat(closestDataPoint.value);

    // Cache the result
    priceCache[cacheKey] = {
      price,
      timestamp: Date.now(),
    };

    return price;
  } catch (error) {
    console.error('Error fetching historical price from Alchemy:', error);
    // Fallback to hourly data
    return getHistoricalPriceHourly(symbol, timestamp, network);
  }
}

/**
 * Fallback: Get hourly historical price
 * Used when 5-minute data is unavailable
 */
async function getHistoricalPriceHourly(
  symbol: 'ETH' | 'USDC',
  timestamp: number,
  network: Network
): Promise<number> {
  try {
    const alchemy = getAlchemyInstance(network);

    // Query 2-hour window
    const startTime = timestamp - 3600; // 1 hour before
    const endTime = timestamp + 3600;   // 1 hour after

    const response = await alchemy.prices.getHistoricalPriceBySymbol(
      symbol,
      startTime,
      endTime,
      HistoricalPriceInterval.ONE_HOUR
    );

    if (!response.data || response.data.length === 0) {
      // Last resort: use current price
      console.warn(`No hourly data for ${symbol} at ${timestamp}, using current price`);
      return getCurrentPrice(symbol, network);
    }

    const closestDataPoint = response.data.reduce((prev, curr) => {
      const prevTime = new Date(prev.timestamp).getTime() / 1000;
      const currTime = new Date(curr.timestamp).getTime() / 1000;
      const prevDiff = Math.abs(prevTime - timestamp);
      const currDiff = Math.abs(currTime - timestamp);
      return currDiff < prevDiff ? curr : prev;
    });

    return parseFloat(closestDataPoint.value);
  } catch (error) {
    console.error('Error fetching hourly price from Alchemy:', error);
    return getCurrentPrice(symbol, network);
  }
}

/**
 * Get current price for a token (fallback when historical data unavailable)
 */
async function getCurrentPrice(symbol: 'ETH' | 'USDC', network: Network): Promise<number> {
  try {
    const alchemy = getAlchemyInstance(network);

    const response = await alchemy.prices.getTokenPriceBySymbol([symbol]);

    if (!response.data || response.data.length === 0 || !response.data[0].prices[0]) {
      throw new Error(`No current price data for ${symbol}`);
    }

    return parseFloat(response.data[0].prices[0].value);
  } catch (error) {
    console.error('Error fetching current price from Alchemy:', error);
    // Last resort fallback values
    return symbol === 'ETH' ? 3000 : 1.0;
  }
}

/**
 * Convert token amount to USD using historical price
 *
 * @param amount - Amount in tokens (ETH or USDC)
 * @param currency - Currency type ('ETH' or 'USDC')
 * @param timestamp - Unix timestamp in seconds
 * @param network - Blockchain network
 * @returns USD value
 */
export async function convertToUsd(
  amount: number,
  currency: 'ETH' | 'USDC',
  timestamp: number,
  network: Network
): Promise<number> {
  const price = await getHistoricalPrice(currency, timestamp, network);
  return amount * price;
}
