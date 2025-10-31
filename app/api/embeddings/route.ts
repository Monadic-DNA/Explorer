import { NextRequest, NextResponse } from "next/server";
import { embeddingService } from "@/lib/embedding-service";
import { validateOrigin } from "@/lib/origin-validator";

/**
 * POST /api/embeddings
 * Generate embeddings for text strings server-side
 *
 * Body: { texts: string[] }
 * Returns: { embeddings: number[][] }
 */
export async function POST(request: NextRequest) {
  // Validate origin
  const originError = validateOrigin(request);
  if (originError) return originError;

  try {
    const body = await request.json();
    const { texts } = body;

    if (!texts || !Array.isArray(texts)) {
      return NextResponse.json(
        { error: "Invalid request: texts array required" },
        { status: 400 }
      );
    }

    if (texts.length === 0) {
      return NextResponse.json({ embeddings: [] });
    }

    if (texts.length > 1000) {
      return NextResponse.json(
        { error: "Too many texts: maximum 1000 per request" },
        { status: 400 }
      );
    }

    console.log(`[Embeddings API] Generating embeddings for ${texts.length} texts...`);
    const startTime = Date.now();

    // Generate embeddings in parallel
    const embeddings = await Promise.all(
      texts.map(async (text) => {
        try {
          return await embeddingService.embed(text);
        } catch (error) {
          console.error(`[Embeddings API] Failed to generate embedding for: "${text}"`, error);
          return null;
        }
      })
    );

    const elapsed = Date.now() - startTime;
    const successCount = embeddings.filter(e => e !== null).length;
    console.log(`[Embeddings API] Generated ${successCount}/${texts.length} embeddings in ${elapsed}ms`);

    return NextResponse.json({ embeddings });
  } catch (error) {
    console.error("[Embeddings API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate embeddings" },
      { status: 500 }
    );
  }
}
