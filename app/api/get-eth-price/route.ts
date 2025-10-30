import { NextResponse } from 'next/server';
import { Alchemy, Network } from 'alchemy-sdk';

export async function GET() {
  try {
    const alchemy = new Alchemy({
      apiKey: process.env.ALCHEMY_API_KEY!,
      network: Network.ETH_MAINNET,
    });

    const response = await alchemy.prices.getTokenPriceBySymbol(['ETH']);

    if (!response.data || response.data.length === 0 || !response.data[0].prices[0]) {
      throw new Error('No price data available');
    }

    const price = parseFloat(response.data[0].prices[0].value);

    return NextResponse.json({
      success: true,
      price,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch ETH price',
        price: 3000 // Fallback price
      },
      { status: 500 }
    );
  }
}
