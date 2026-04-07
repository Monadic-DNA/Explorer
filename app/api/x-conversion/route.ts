/**
 * X (Twitter) Conversions API endpoint
 *
 * Server-side conversion tracking for X Ads
 * Sends conversion events with match keys for improved attribution
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { eventType, metadata } = await request.json();

    // Get X API credentials from environment
    const pixelId = process.env.NEXT_PUBLIC_X_PIXEL_ID;
    const accessToken = process.env.X_CONVERSIONS_API_TOKEN;

    // Debug: Log env var status
    console.log('[X Conversion] Env check:', {
      pixelId,
      hasToken: !!accessToken,
      tokenLength: accessToken?.length,
    });

    if (!pixelId || !accessToken) {
      console.warn('[X Conversion] X API not configured');
      return NextResponse.json(
        { error: 'X Conversions API not configured' },
        { status: 500 }
      );
    }

    // Extract match keys from request
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') ||
               'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Build conversion event payload according to X API spec
    const event: any = {
      conversion_time: new Date().toISOString(),
      event_id: metadata?.conversion_id || `${eventType}_${Date.now()}`,
      identifiers: [],
    };

    // Add match keys (identifiers)
    if (ip !== 'unknown') {
      event.identifiers.push({
        hashed_ip_address: ip, // X will hash this server-side
      });
    }

    // Add conversion metadata
    if (eventType === 'Purchase' && metadata?.value) {
      event.conversion_value = metadata.value;
      event.currency = metadata.currency || 'USD';
    }

    const payload = {
      conversions: [
        {
          conversion_event: eventType,
          ...event,
        },
      ],
    };

    // Debug logging
    console.log('[X Conversion] Sending request:', {
      url: `https://ads-api.x.com/12/measurement/conversions/${pixelId}`,
      eventType,
      hasAccessToken: !!accessToken,
      accessTokenPrefix: accessToken.substring(0, 20) + '...',
      payload: JSON.stringify(payload, null, 2),
    });

    // Send to X Conversions API
    const response = await fetch(
      `https://ads-api.x.com/12/measurement/conversions/${pixelId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[X Conversion] API error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to send conversion event' },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json({ success: true, result });

  } catch (error) {
    console.error('[X Conversion] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
