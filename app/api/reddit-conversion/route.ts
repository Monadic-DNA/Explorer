/**
 * Reddit Conversions API endpoint
 *
 * Server-side conversion tracking for Reddit Ads
 * Sends conversion events with match keys for improved attribution
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { eventType, metadata } = await request.json();

    // Get Reddit API credentials from environment
    const pixelId = process.env.REDDIT_PIXEL_ID || 'a2_iom6tk9tutrs';
    const accessToken = process.env.REDDIT_CONVERSIONS_API_TOKEN;

    if (!accessToken) {
      console.warn('[Reddit Conversion] No access token configured');
      return NextResponse.json(
        { error: 'Reddit Conversions API not configured' },
        { status: 500 }
      );
    }

    // Extract match keys from request
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') ||
               'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Build conversion event payload
    const payload = {
      data: {
        events: [
          {
            event_at: Date.now(),
            action_source: 'web',
            type: {
              tracking_type: eventType, // 'SignUp' or 'Purchase'
            },
            click_id: undefined, // Reddit click ID if available from URL params
            user: {
              ip_address: ip !== 'unknown' ? ip : undefined,
              user_agent: userAgent !== 'unknown' ? userAgent : undefined,
            },
            metadata: metadata || undefined,
          },
        ],
      },
    };

    // Send to Reddit Conversions API
    const response = await fetch(
      `https://ads-api.reddit.com/api/v3/pixels/${pixelId}/conversion_events`,
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
      console.error('[Reddit Conversion] API error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to send conversion event' },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json({ success: true, result });

  } catch (error) {
    console.error('[Reddit Conversion] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
