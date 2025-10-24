import { NextRequest, NextResponse } from "next/server";
import { executeQuerySingle, getDbType } from "@/lib/db";
import { validateOrigin } from "@/lib/origin-validator";

// This endpoint only returns study metadata - NO user genetic data is processed here
export async function POST(request: NextRequest) {
  // Validate origin
  const originError = validateOrigin(request);
  if (originError) return originError;

  try {
    const { studyId } = await request.json();

    if (!studyId) {
      return NextResponse.json({
        success: false,
        error: 'Missing study ID'
      }, { status: 400 });
    }

    // Get study metadata from database (contains no user data)
    const dbType = getDbType();

    // NOTE: hashtext() is a 32-bit non-cryptographic hash with potential collision risk.
    // Given the composite key (study_accession + snps + risk_allele + p_value + OR),
    // collision probability is low in practice for GWAS catalog size.
    // For high-security production, consider adding a stable UUID column during ingestion.
    const idCondition = dbType === 'postgres'
      ? 'hashtext(COALESCE(study_accession, \'\') || COALESCE(snps, \'\') || COALESCE(strongest_snp_risk_allele, \'\') || COALESCE(p_value, \'\') || COALESCE(or_or_beta::text, \'\')) = ?'
      : 'rowid = ?';

    const query = `
      SELECT
        snps,
        strongest_snp_risk_allele,
        or_or_beta,
        ci_text,
        study_accession,
        disease_trait
      FROM gwas_catalog
      WHERE ${idCondition}
      AND snps IS NOT NULL AND snps != ''
      AND strongest_snp_risk_allele IS NOT NULL AND strongest_snp_risk_allele != ''
      AND or_or_beta IS NOT NULL AND or_or_beta != ''
    `;

    const study = await executeQuerySingle<{
      snps: string | null;
      strongest_snp_risk_allele: string | null;
      or_or_beta: string | null;
      ci_text: string | null;
      study_accession: string | null;
      disease_trait: string | null;
    }>(query, [studyId]);

    if (!study) {
      return NextResponse.json({
        success: false,
        error: 'Study not found or missing required data'
      }, { status: 404 });
    }

    // Determine effect type from ci_text
    // Beta coefficients have "increase" or "decrease" in CI text
    // e.g., "[NR] unit increase", "[0.0068-0.0139] unit increase", "[112.27-112.33] increase"
    // Odds ratios are just numbers: e.g., "[1.08-1.15]"
    const ciTextLower = study.ci_text?.toLowerCase() ?? '';
    const isBeta = ciTextLower.includes('increase') || ciTextLower.includes('decrease');
    const effectType = isBeta ? 'beta' : 'OR';

    // Debug logging

    // Return only study metadata - client will perform the analysis
    return NextResponse.json({
      success: true,
      study: {
        snps: study.snps,
        riskAllele: study.strongest_snp_risk_allele,
        effectSize: study.or_or_beta,
        effectType: effectType,
        confidenceInterval: study.ci_text,
        gwasId: study.study_accession,
      }
    });

  } catch (error) {
    console.error('Study analysis error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error during analysis' 
    }, { status: 500 });
  }
}
