import { NextRequest, NextResponse } from "next/server";
import { executeQuerySingle } from "@/lib/db";
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
    const query = `
      SELECT
        snps,
        strongest_snp_risk_allele,
        or_or_beta,
        ci_text,
        study_accession,
        disease_trait
      FROM gwas_catalog
      WHERE id = $1
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
    const hasIncrease = ciTextLower.includes('increase');
    const hasDecrease = ciTextLower.includes('decrease');
    const isBeta = hasIncrease || hasDecrease;
    const effectType = isBeta ? 'beta' : 'OR';

    // CRITICAL FIX: GWAS Catalog stores ALL beta values as positive numbers
    // Direction is encoded in ci_text ("increase" vs "decrease")
    // We must negate the value for "decrease" studies before sending to client
    let effectSize = study.or_or_beta;
    if (isBeta && hasDecrease && !hasIncrease) {
      const numericValue = parseFloat(study.or_or_beta || '0');
      effectSize = (-Math.abs(numericValue)).toString();
    }

    // Return only study metadata - client will perform the analysis
    return NextResponse.json({
      success: true,
      study: {
        snps: study.snps,
        riskAllele: study.strongest_snp_risk_allele,
        effectSize: effectSize,
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
