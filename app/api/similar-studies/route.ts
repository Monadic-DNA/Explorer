import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { validateOrigin } from "@/lib/origin-validator";
import { embeddingService } from "@/lib/embedding-service";

/**
 * POST /api/similar-studies
 * Find studies most similar to a query using vector similarity search
 *
 * Body: { query: string, limit: number }
 * Returns: { studies: Array<{ study_accession, snps, strongest_snp_risk_allele, similarity }> }
 */
export async function POST(request: NextRequest) {
  // Validate origin
  const originError = validateOrigin(request);
  if (originError) return originError;

  try {
    const body = await request.json();
    const { query, limit = 500 } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: "Invalid request: query string required" },
        { status: 400 }
      );
    }

    if (limit > 1000) {
      return NextResponse.json(
        { error: "Limit cannot exceed 1000" },
        { status: 400 }
      );
    }

    console.log(`[Similar Studies API] Finding ${limit} studies similar to: "${query}"`);
    const startTime = Date.now();

    // Generate embedding for query
    const queryEmbedding = await embeddingService.embed(query);

    // Get database connection
    const dbConn = getDb();

    if (dbConn.type !== 'postgres' || !dbConn.postgres) {
      return NextResponse.json(
        { error: "Vector similarity search requires PostgreSQL" },
        { status: 503 }
      );
    }

    // Use PostgreSQL's vector similarity search with HNSW index
    // cosine distance: 1 - cosine similarity (lower is more similar)
    const sqlQuery = `
      SELECT
        study_accession,
        snps,
        strongest_snp_risk_allele,
        1 - (embedding <=> $1::vector) as similarity
      FROM study_embeddings
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;

    const result = await dbConn.postgres.query(sqlQuery, [JSON.stringify(queryEmbedding), limit]);

    const elapsed = Date.now() - startTime;
    console.log(`[Similar Studies API] Found ${result.rows.length} similar studies in ${elapsed}ms`);

    return NextResponse.json({
      studies: result.rows,
      query_embedding_dims: queryEmbedding.length
    });
  } catch (error) {
    console.error("[Similar Studies API] Error:", error);
    return NextResponse.json(
      { error: "Failed to find similar studies" },
      { status: 500 }
    );
  }
}
