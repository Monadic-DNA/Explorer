/**
 * Health check endpoint
 *
 * - Checks if app is running
 * - Warms up embedding model on startup (prevents cold start delays)
 * - Used by DO App Platform for readiness checks
 */

import { NextResponse } from 'next/server';
import { embeddingService } from '@/lib/embedding-service';

export async function GET() {
  try {
    // Initialize embedding model (no-op if already loaded)
    await embeddingService.initialize();

    const info = embeddingService.getInfo();

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      embedding: {
        modelLoaded: info.ready,
        modelName: info.modelName,
        dimensions: info.dimensions,
        quantized: info.quantized,
      },
    });
  } catch (error) {
    console.error('[Health] Model initialization error:', error);

    return NextResponse.json(
      {
        status: 'warming',
        timestamp: new Date().toISOString(),
        embedding: {
          modelLoaded: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 503 }
    );
  }
}
