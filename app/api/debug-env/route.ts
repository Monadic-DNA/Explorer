import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    X_PIXEL_ID: process.env.NEXT_PUBLIC_X_PIXEL_ID,
    X_TOKEN_EXISTS: !!process.env.X_CONVERSIONS_API_TOKEN,
    X_TOKEN_LENGTH: process.env.X_CONVERSIONS_API_TOKEN?.length || 0,
    X_TOKEN_PREFIX: process.env.X_CONVERSIONS_API_TOKEN?.substring(0, 20) || 'MISSING',
  });
}
