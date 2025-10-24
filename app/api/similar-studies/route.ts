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

    if (limit > 5000) {
      return NextResponse.json(
        { error: "Limit cannot exceed 5000" },
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
    // Strategy: Aggregate at study level to avoid missing SNPs due to gene context in embeddings
    // For each study, we take the MAX similarity across all its SNPs
    const sqlQuery = `
      WITH ranked_studies AS (
        SELECT
          study_accession,
          MAX(1 - (embedding <=> $1::vector)) as max_similarity
        FROM study_embeddings
        GROUP BY study_accession
        ORDER BY max_similarity DESC
        LIMIT $2
      )
      SELECT DISTINCT
        rs.study_accession,
        rs.max_similarity as similarity
      FROM ranked_studies rs
      ORDER BY rs.max_similarity DESC
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
