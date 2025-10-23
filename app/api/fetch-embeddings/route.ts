import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateOrigin } from "@/lib/origin-validator";

/**
 * POST /api/fetch-embeddings
 * Fetch pre-computed embeddings from PostgreSQL by composite keys
 *
 * Body: { keys: Array<{ study_accession: string, snps: string, strongest_snp_risk_allele: string }> }
 * Returns: { embeddings: Array<{ key: string, embedding: number[] | null }> }
 */
export async function POST(request: NextRequest) {
  // Validate origin
  const originError = validateOrigin(request);
  if (originError) return originError;

  try {
    const body = await request.json();
    const { keys } = body;

    if (!keys || !Array.isArray(keys)) {
      return NextResponse.json(
        { error: "Invalid request: keys array required" },
        { status: 400 }
      );
    }

    if (keys.length === 0) {
      return NextResponse.json({ embeddings: [] });
    }

    if (keys.length > 1000) {
      return NextResponse.json(
        { error: "Too many keys: maximum 1000 per request" },
        { status: 400 }
      );
    }

    console.log(`[Fetch Embeddings API] Fetching ${keys.length} embeddings from PostgreSQL...`);
    const startTime = Date.now();

    // Build WHERE clause for batch lookup
    const conditions = keys.map((_, i) =>
      `(study_accession = $${i * 3 + 1} AND snps = $${i * 3 + 2} AND strongest_snp_risk_allele = $${i * 3 + 3})`
    ).join(' OR ');

    const params = keys.flatMap((k: any) => [k.study_accession, k.snps, k.strongest_snp_risk_allele]);

    const query = `
      SELECT study_accession, snps, strongest_snp_risk_allele, embedding
      FROM study_embeddings
      WHERE ${conditions}
    `;

    const result = await db.query(query, params);

    // Create lookup map
    const embeddingMap = new Map<string, number[]>();
    for (const row of result.rows) {
      const key = `${row.study_accession}|${row.snps}|${row.strongest_snp_risk_allele}`;
      embeddingMap.set(key, row.embedding);
    }

    // Return embeddings in same order as keys
    const embeddings = keys.map((k: any) => {
      const key = `${k.study_accession}|${k.snps}|${k.strongest_snp_risk_allele}`;
      return {
        key,
        embedding: embeddingMap.get(key) || null
      };
    });

    const elapsed = Date.now() - startTime;
    const foundCount = embeddings.filter(e => e.embedding !== null).length;
    console.log(`[Fetch Embeddings API] Found ${foundCount}/${keys.length} embeddings in ${elapsed}ms`);

    return NextResponse.json({ embeddings });
  } catch (error) {
    console.error("[Fetch Embeddings API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch embeddings" },
      { status: 500 }
    );
  }
}
