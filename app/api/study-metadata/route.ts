import { NextRequest, NextResponse } from 'next/server';
import { executeQuerySingle } from '@/lib/db';
import { validateOrigin } from '@/lib/origin-validator';

export async function GET(request: NextRequest) {
  // Validate origin
  const originError = validateOrigin(request);
  if (originError) return originError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const studyId = searchParams.get('studyId');

    if (!studyId) {
      return NextResponse.json(
        { error: 'Missing study ID' },
        { status: 400 }
      );
    }

    const query = `
      SELECT
        initial_sample_size,
        replication_sample_size,
        p_value,
        pvalue_mlog,
        study_accession,
        pubmedid,
        first_author,
        date,
        journal
      FROM gwas_catalog
      WHERE id = $1
    `;

    const metadata = await executeQuerySingle<{
      initial_sample_size: string | null;
      replication_sample_size: string | null;
      p_value: string | null;
      pvalue_mlog: string | null;
      study_accession: string | null;
      pubmedid: string | null;
      first_author: string | null;
      date: string | null;
      journal: string | null;
    }>(query, [studyId]);

    if (!metadata) {
      return NextResponse.json(
        { error: 'Study not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      metadata,
    });

  } catch (error) {
    console.error('Error fetching study metadata:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch study metadata' },
      { status: 500 }
    );
  }
}
