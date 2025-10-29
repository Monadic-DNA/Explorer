/**
 * CoinGecko API integration for historical token prices (ETH, USDC)
 * Free tier: 10-30 calls/minute
 * Docs: https://www.coingecko.com/en/api/documentation
 */

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
 * Get historical price for a token at a specific timestamp
 * @param coinId - CoinGecko coin ID ('ethereum' or 'usd-coin')
 * @param timestamp - Unix timestamp in seconds
 * @returns Price in USD
 */
export async function getHistoricalPrice(
  coinId: 'ethereum' | 'usd-coin',
  timestamp: number
): Promise<number> {
  // USDC is pegged to $1, no need to query
  if (coinId === 'usd-coin') {
    return 1.0;
  }

  // Convert timestamp to date string (dd-mm-yyyy format for CoinGecko)
  const date = new Date(timestamp * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const dateStr = `${day}-${month}-${year}`;

  // Check cache first
  const cacheKey = `${coinId}_${dateStr}`;
  const cached = priceCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  // Query CoinGecko API
  const apiKey = process.env.COINGECKO_API_KEY;
  const baseUrl = apiKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';

  const headers: HeadersInit = apiKey
    ? { 'x-cg-pro-api-key': apiKey }
    : {};

  try {
    const url = `${baseUrl}/coins/${coinId}/history?date=${dateStr}&localization=false`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      // If historical data unavailable, fall back to current price
      console.warn(`CoinGecko historical price unavailable for ${dateStr}, using current price`);
      return getCurrentPrice(coinId);
    }

    const data = await response.json();
    const price = data.market_data?.current_price?.usd;

    if (!price) {
      throw new Error(`No price data returned from CoinGecko for ${coinId} on ${dateStr}`);
    }

    // Cache the result
    priceCache[cacheKey] = {
      price,
      timestamp: Date.now(),
    };

    return price;
  } catch (error) {
    console.error('Error fetching historical price:', error);
    // Fallback to current price if historical lookup fails
    return getCurrentPrice(coinId);
  }
}

/**
 * Get current price for a token (fallback when historical data unavailable)
 * @param coinId - CoinGecko coin ID
 * @returns Current price in USD
 */
async function getCurrentPrice(coinId: 'ethereum' | 'usd-coin'): Promise<number> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const baseUrl = apiKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';

  const headers: HeadersInit = apiKey
    ? { 'x-cg-pro-api-key': apiKey }
    : {};

  try {
    const url = `${baseUrl}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch current price: ${response.statusText}`);
    }

    const data = await response.json();
    const price = data[coinId]?.usd;

    if (!price) {
      throw new Error(`No current price data for ${coinId}`);
    }

    return price;
  } catch (error) {
    console.error('Error fetching current price:', error);
    // Last resort fallback values
    return coinId === 'ethereum' ? 3000 : 1.0;
  }
}

/**
 * Convert token amount to USD
 * @param amount - Amount in tokens (ETH or USDC)
 * @param currency - Currency type ('ETH' or 'USDC')
 * @param timestamp - Unix timestamp in seconds
 * @returns USD value
 */
export async function convertToUsd(
  amount: number,
  currency: 'ETH' | 'USDC',
  timestamp: number
): Promise<number> {
  const coinId = currency === 'ETH' ? 'ethereum' : 'usd-coin';
  const price = await getHistoricalPrice(coinId, timestamp);
  return amount * price;
}
