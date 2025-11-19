import { NextRequest, NextResponse } from "next/server";

import { executeQuery, executeQuerySingle, getDbType } from "@/lib/db";
import { validateOrigin } from "@/lib/origin-validator";
import {
  computeQualityFlags,
  formatNumber,
  formatPValue,
  parseLogPValue,
  parsePValue,
  parseSampleSize,
  QualityFlag,
} from "@/lib/parsing";
import { embeddingService } from "@/lib/embedding-service";

type ConfidenceBand = "high" | "medium" | "low";

type RawStudy = {
  id: number;
  study_accession: string | null;
  study: string | null;
  disease_trait: string | null;
  mapped_trait: string | null;
  mapped_trait_uri: string | null;
  mapped_gene: string | null;
  first_author: string | null;
  date: string | null;
  journal: string | null;
  pubmedid: string | null;
  link: string | null;
  initial_sample_size: string | null;
  replication_sample_size: string | null;
  p_value: string | null;
  pvalue_mlog: string | null;
  or_or_beta: string | null;
  risk_allele_frequency: string | null;
  strongest_snp_risk_allele: string | null;
  snps: string | null;
  similarity?: number; // Semantic search similarity score (0-1)
};

type Study = RawStudy & {
  sampleSize: number | null;
  sampleSizeLabel: string;
  pValueNumeric: number | null;
  pValueLabel: string;
  logPValue: number | null;
  qualityFlags: QualityFlag[];
  isLowQuality: boolean;
  confidenceBand: ConfidenceBand;
  publicationDate: number | null;
  isAnalyzable: boolean;
  nonAnalyzableReason?: string;
};

function normalizeYear(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (value.length === 2) {
    return numeric >= 70 ? 1900 + numeric : 2000 + numeric;
  }
  if (value.length === 3) {
    return numeric >= 100 ? numeric : null;
  }
  if (numeric < 0) {
    return null;
  }
  return numeric;
}

function buildUtcTimestamp(year: number | null, month: number | null, day: number | null): number | null {
  if (year === null || month === null || day === null) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function parseNumericDate(parts: [number, number, number], assumeDayFirst: boolean): number | null {
  const [first, second, year] = parts;
  const month = assumeDayFirst ? second : first;
  const day = assumeDayFirst ? first : second;
  return buildUtcTimestamp(year, month, day);
}

const monthNames: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthFromName(name: string | undefined): number | null {
  if (!name) {
    return null;
  }
  const key = name.trim().toLowerCase();
  if (!key) {
    return null;
  }
  return monthNames[key] ?? null;
}

function parseStudyDate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) {
    return direct;
  }

  const slashMatch = trimmed.match(/^([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = normalizeYear(slashMatch[3]);
    if (!Number.isFinite(first) || !Number.isFinite(second) || year === null) {
      return null;
    }
    return (
      parseNumericDate([first, second, year], false) ??
      parseNumericDate([first, second, year], true)
    );
  }

  const textualDayFirst = trimmed.match(/^([0-9]{1,2})\s+([A-Za-z]+)\s+([0-9]{2,4})$/);
  if (textualDayFirst) {
    const day = Number(textualDayFirst[1]);
    const month = monthFromName(textualDayFirst[2]);
    const year = normalizeYear(textualDayFirst[3]);
    if (!Number.isFinite(day) || month === null || year === null) {
      return null;
    }
    return buildUtcTimestamp(year, month, day);
  }

  const textualMonthFirst = trimmed.match(/^([A-Za-z]+)[\s-]+([0-9]{1,2}),?\s*([0-9]{2,4})$/);
  if (textualMonthFirst) {
    const month = monthFromName(textualMonthFirst[1]);
    const day = Number(textualMonthFirst[2]);
    const year = normalizeYear(textualMonthFirst[3]);
    if (month === null || !Number.isFinite(day) || year === null) {
      return null;
    }
    return buildUtcTimestamp(year, month, day);
  }

  return null;
}

function parseInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function determineConfidenceBand(
  sampleSize: number | null,
  pValue: number | null,
  logPValue: number | null,
  qualityFlags: Array<{ severity: string }>,
): ConfidenceBand {
  // Only downgrade to low if there are MAJOR quality issues
  const hasMajorFlags = qualityFlags.some(flag => flag.severity === 'major');

  if (hasMajorFlags) {
    return "low";
  }

  const meetsHigh =
    sampleSize !== null &&
    sampleSize >= 5000 &&
    logPValue !== null &&
    logPValue >= 9 &&
    (pValue === null || pValue <= 5e-9);

  if (meetsHigh) {
    return "high";
  }

  const meetsMedium =
    ((sampleSize ?? 0) >= 2000 || (logPValue ?? 0) >= 7) &&
    (pValue === null || pValue <= 1e-6);

  if (meetsMedium) {
    return "medium";
  }

  // Minor flags don't prevent medium classification
  // but studies with minor flags and not meeting medium criteria are low
  return "low";
}

export async function GET(request: NextRequest) {
  // Validate origin
  const originError = validateOrigin(request);
  if (originError) return originError;

  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get("search")?.trim();
  const trait = searchParams.get("trait")?.trim();
  const searchMode = searchParams.get("searchMode") ?? "similarity"; // "similarity" or "exact"
  const useSemanticSearch = searchMode === "similarity"; // Use semantic search only for similarity mode

  // Special parameter for "Run All" - fetches all studies with SNPs
  const fetchAll = searchParams.get("fetchAll") === "true";
  // Allow larger batches for pagination (up to 100000 for Run All with fetchAll)
  const requestedLimit = Number(searchParams.get("limit")) || 75;
  const limit = fetchAll ? Math.max(10, Math.min(requestedLimit, 100000)) : Math.max(10, Math.min(requestedLimit, 50000));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const sort = searchParams.get("sort") ?? "relevance";
  const direction = searchParams.get("direction") === "asc" ? "asc" : "desc";
  const minSampleSize = parseInteger(searchParams.get("minSampleSize"));
  const maxPValueRaw = searchParams.get("maxPValue");
  const minLogPRaw = searchParams.get("minLogP");
  const excludeLowQuality = searchParams.get("excludeLowQuality") === "false" ? false : true;
  const excludeMissingGenotype = searchParams.get("excludeMissingGenotype") === "false" ? false : true;
  const confidenceBandParam = searchParams.get("confidenceBand");
  const confidenceBandFilter: ConfidenceBand | null =
    confidenceBandParam === "high" || confidenceBandParam === "medium" || confidenceBandParam === "low"
      ? (confidenceBandParam as ConfidenceBand)
      : null;

  const filters: string[] = [];
  const params: unknown[] = [];
  let orderByClause = "";
  let useSemanticQuery = false;
  let queryEmbedding: number[] = [];

  // Semantic search: Generate embedding for query
  if (search && useSemanticSearch) {
    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Semantic Search] Embedding query: "${search}"`);
      }
      queryEmbedding = await embeddingService.embed(search);
      useSemanticQuery = true;
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Semantic Search] Embedding generated (${queryEmbedding.length} dims)`);
      }
    } catch (error) {
      console.error(`[Semantic Search] Failed to generate embedding:`, error);
      // Fall back to keyword search
      useSemanticQuery = false;
    }
  }

  // Build search filters
  if (search && !useSemanticQuery) {
    // Keyword search (fallback or when semantic is disabled)
    const wildcard = `%${search}%`;
    filters.push(
      "(gc.study LIKE ? OR gc.disease_trait LIKE ? OR gc.mapped_trait LIKE ? OR gc.first_author LIKE ? OR gc.mapped_gene LIKE ? OR gc.study_accession LIKE ? OR gc.snps LIKE ?)",
    );
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
  } else if (useSemanticQuery) {
    // Semantic search: Use separate study_embeddings table
    const dbType = getDbType();

    if (dbType === 'postgres') {
      // PostgreSQL: Semantic search handled in FROM clause subquery
      // The subquery already filters and orders by similarity
      // Just order by the distance column from the subquery
      orderByClause = `ORDER BY se.distance`;
    } else {
      // SQLite: No native vector support, fall back to keyword search
      console.warn(`[Semantic Search] SQLite doesn't support vector similarity, falling back to keyword search`);
      const wildcard = `%${search}%`;
      filters.push(
        "(gc.study LIKE ? OR gc.disease_trait LIKE ? OR gc.mapped_trait LIKE ? OR gc.first_author LIKE ? OR gc.mapped_gene LIKE ? OR gc.study_accession LIKE ? OR gc.snps LIKE ?)",
      );
      params.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
      useSemanticQuery = false;
    }
  }

  if (trait) {
    filters.push("(gc.mapped_trait = ? OR gc.disease_trait = ?)");
    params.push(trait, trait);
  }

  // For fetchAll, always require SNPs and risk alleles (since we're doing SNP matching)
  if (fetchAll) {
    filters.push("(gc.snps IS NOT NULL AND gc.snps != '')");
    filters.push("(gc.strongest_snp_risk_allele IS NOT NULL AND gc.strongest_snp_risk_allele != '')");
  }

  // Add backend filters to SQL WHERE clause
  const maxPValue = maxPValueRaw ? parsePValue(maxPValueRaw) : null;
  const minLogP = minLogPRaw ? Number(minLogPRaw) : null;

  // Get database type first to use appropriate syntax
  const dbType = getDbType();

  if (minSampleSize !== null) {
    // Filter for minimum sample size
    // Check both initial_sample_size and replication_sample_size
    // Note: Some values contain text like "1,000 cases, 1,034 controls"
    // Extract only the first number to avoid overflow from concatenating multiple numbers
    if (dbType === 'postgres') {
      // Extract first number with commas, then remove commas
      filters.push("((NULLIF(regexp_replace((regexp_match(gc.initial_sample_size, '[0-9,]+'))[1], ',', '', 'g'), '')::numeric >= ?::numeric) OR (NULLIF(regexp_replace((regexp_match(gc.replication_sample_size, '[0-9,]+'))[1], ',', '', 'g'), '')::numeric >= ?::numeric))");
    } else {
      filters.push("((CAST(gc.initial_sample_size AS INTEGER) >= ?) OR (CAST(gc.replication_sample_size AS INTEGER) >= ?))");
    }
    params.push(minSampleSize, minSampleSize);
  }

  if (maxPValue !== null) {
    // Filter for maximum p-value
    // Use pvalue_mlog to avoid numeric overflow with extreme p-values like 1E-18716
    // Convert: maxPValue = 5e-8 => minLogP = -log10(5e-8) ≈ 7.3
    const minLogPFromMaxP = -Math.log10(maxPValue);
    if (dbType === 'postgres') {
      filters.push("(gc.pvalue_mlog IS NULL OR gc.pvalue_mlog::numeric >= ?::numeric)");
    } else {
      filters.push("(gc.pvalue_mlog IS NULL OR CAST(gc.pvalue_mlog AS REAL) >= ?)");
    }
    params.push(minLogPFromMaxP);
  }

  if (minLogP !== null) {
    // Filter for minimum -log10(p-value)
    if (dbType === 'postgres') {
      filters.push("gc.pvalue_mlog::numeric >= ?::numeric");
    } else {
      filters.push("CAST(gc.pvalue_mlog AS REAL) >= ?");
    }
    params.push(minLogP);
  }

  if (excludeMissingGenotype) {
    // Filter out studies with missing or invalid genotype data
    filters.push("(gc.strongest_snp_risk_allele IS NOT NULL AND gc.strongest_snp_risk_allele != '' AND gc.strongest_snp_risk_allele != '?' AND gc.strongest_snp_risk_allele != 'NR' AND gc.strongest_snp_risk_allele NOT LIKE '%?%')");
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const idSelection = 'gc.id';

  // Calculate rawLimit first (needed for HNSW candidate limit calculation)
  // Most filters now run in SQL, so we only need a small buffer for excludeLowQuality and confidenceBand
  // These filters are applied post-query in JavaScript
  const needsPostFilterBuffer = excludeLowQuality || confidenceBandFilter !== null;
  const isRunAllQuery = excludeLowQuality === false && excludeMissingGenotype === false && !search && !trait;
  // Use 2x buffer for post-filtering to ensure enough results after JS-side filtering
  // Respect user's limit choice (removed arbitrary 200 cap)
  const rawLimit = fetchAll ? limit : (needsPostFilterBuffer ? limit * 2 : limit);

  // Build FROM clause - for semantic search, query embeddings table first, then join
  // This allows the HNSW index to be used efficiently
  let fromClause = 'FROM gwas_catalog gc';

  if (useSemanticQuery && dbType === 'postgres') {
    // Two-stage query for efficient HNSW index usage:
    // 1. First: Use HNSW index to get top candidate embeddings (fast!)
    // 2. Then: JOIN with gwas_catalog using composite key (study_accession, snps, strongest_snp_risk_allele)
    // This prevents full table scans by letting the HNSW index do the heavy lifting

    const vectorLiteral = `'${JSON.stringify(queryEmbedding)}'::vector`;
    // Dynamic candidate limit based on user's requested limit and filter strictness
    // Use larger multiplier when filters are active to ensure enough results after filtering
    const hasStrictFilters = minSampleSize !== null || maxPValue !== null || minLogP !== null || excludeMissingGenotype;
    const candidateMultiplier = hasStrictFilters ? 10 : 5; // 10x with filters, 5x without
    const hnswCandidateLimit = Math.max(1000, Math.min(rawLimit * candidateMultiplier, 10000));

    fromClause = `FROM (
      SELECT study_accession, snps, strongest_snp_risk_allele, embedding
      FROM study_embeddings
      ORDER BY embedding <=> ${vectorLiteral}
      LIMIT ${hnswCandidateLimit}
    ) se
    INNER JOIN gwas_catalog gc ON (
      se.study_accession = gc.study_accession
      AND se.snps = gc.snps
      AND se.strongest_snp_risk_allele = gc.strongest_snp_risk_allele
    )`;

    // Update order by to use embedding distance (ASC = lowest distance first = highest similarity first = descending similarity)
    orderByClause = `ORDER BY se.embedding <=> ${vectorLiteral}`;
  }

  // Add similarity score for semantic search
  const similarityColumn = useSemanticQuery && dbType === 'postgres'
    ? `,\n       (1 - (se.embedding <=> ${`'${JSON.stringify(queryEmbedding)}'::vector`})) as similarity`
    : '';

  const baseQuery = `SELECT ${idSelection},
       gc.study_accession,
       gc.study,
       gc.disease_trait,
       gc.mapped_trait,
       gc.mapped_trait_uri,
       gc.mapped_gene,
       gc.first_author,
       gc.date,
       gc.journal,
       gc.pubmedid,
       gc.link,
       gc.initial_sample_size,
       gc.replication_sample_size,
       gc.p_value,
       gc.pvalue_mlog,
       gc.or_or_beta,
       gc.risk_allele_frequency,
       gc.strongest_snp_risk_allele,
       gc.snps${similarityColumn}
    ${fromClause}
    ${whereClause}
    ${orderByClause}`;

  // Add LIMIT/OFFSET directly to query for PostgreSQL (safe since rawLimit and offset are validated integers)
  // This avoids parameter type inference issues with pg driver
  const finalQuery = dbType === 'postgres'
    ? `${baseQuery}\n    LIMIT ${rawLimit} OFFSET ${offset}`
    : `${baseQuery}\n    LIMIT ? OFFSET ?`;

  let rawRows: RawStudy[];

  try {
    // Log query timing for semantic search debugging
    const queryStart = Date.now();
    console.log(`[Query] Starting database query...`);
    if (useSemanticQuery) {
      console.log(`[Query] Semantic search active, params count: ${params.length}`);
      console.log(`[Query] HNSW ef_search is set to 1000 at connection level for better recall`);
    }

    // DEBUG: Print the actual SQL query
    console.log(`[Query] SQL:\n${finalQuery}`);
    console.log(`[Query] First 3 params:`, params.slice(0, 3).map(p => typeof p === 'string' && p.length > 100 ? `${p.substring(0, 100)}...` : p));

    // For PostgreSQL, LIMIT/OFFSET are in the query string; for SQLite, they're in params
    rawRows = dbType === 'postgres'
      ? await executeQuery<RawStudy>(finalQuery, params)
      : await executeQuery<RawStudy>(finalQuery, [...params, rawLimit, offset]);

    const queryElapsed = Date.now() - queryStart;
    console.log(`[Query] Database query completed in ${queryElapsed}ms`);
    console.log(`[Query] Raw rows returned: ${rawRows.length}`);
    if (queryElapsed > 5000) {
      console.warn(`[Query] SLOW QUERY DETECTED: ${queryElapsed}ms - consider database upgrade`);
    }
  } catch (error: any) {
    // If semantic search fails (e.g., study_embeddings table doesn't exist), fall back to keyword search
    if (useSemanticQuery && (error?.message?.includes('study_embeddings') || error?.message?.includes('relation') || error?.message?.includes('does not exist'))) {
      console.warn(`[Semantic Search] Table not found or query failed, falling back to keyword search:`, error.message);

      // Rebuild query without semantic search, using same filters as main query
      const fallbackFilters: string[] = [];
      const fallbackParams: any[] = [];

      // Re-add search as keyword search
      if (search) {
        const wildcard = `%${search}%`;
        fallbackFilters.push(
          "(gc.study LIKE ? OR gc.disease_trait LIKE ? OR gc.mapped_trait LIKE ? OR gc.first_author LIKE ? OR gc.mapped_gene LIKE ? OR gc.study_accession LIKE ? OR gc.snps LIKE ?)",
        );
        fallbackParams.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
      }

      if (trait) {
        fallbackFilters.push("(gc.mapped_trait = ? OR gc.disease_trait = ?)");
        fallbackParams.push(trait, trait);
      }

      if (fetchAll) {
        fallbackFilters.push("(gc.snps IS NOT NULL AND gc.snps != '')");
        fallbackFilters.push("(gc.strongest_snp_risk_allele IS NOT NULL AND gc.strongest_snp_risk_allele != '')");
      }

      // Add the same backend filters as the main query
      if (minSampleSize !== null) {
        if (dbType === 'postgres') {
          // Extract first number with commas, then remove commas
          fallbackFilters.push("((NULLIF(regexp_replace((regexp_match(gc.initial_sample_size, '[0-9,]+'))[1], ',', '', 'g'), '')::numeric >= ?::numeric) OR (NULLIF(regexp_replace((regexp_match(gc.replication_sample_size, '[0-9,]+'))[1], ',', '', 'g'), '')::numeric >= ?::numeric))");
        } else {
          fallbackFilters.push("((CAST(gc.initial_sample_size AS INTEGER) >= ?) OR (CAST(gc.replication_sample_size AS INTEGER) >= ?))");
        }
        fallbackParams.push(minSampleSize, minSampleSize);
      }

      if (maxPValue !== null) {
        // Use pvalue_mlog to avoid numeric overflow with extreme p-values
        const minLogPFromMaxP = -Math.log10(maxPValue);
        if (dbType === 'postgres') {
          fallbackFilters.push("(gc.pvalue_mlog IS NULL OR gc.pvalue_mlog::numeric >= ?::numeric)");
        } else {
          fallbackFilters.push("(gc.pvalue_mlog IS NULL OR CAST(gc.pvalue_mlog AS REAL) >= ?)");
        }
        fallbackParams.push(minLogPFromMaxP);
      }

      if (minLogP !== null) {
        if (dbType === 'postgres') {
          fallbackFilters.push("gc.pvalue_mlog::numeric >= ?::numeric");
        } else {
          fallbackFilters.push("CAST(gc.pvalue_mlog AS REAL) >= ?");
        }
        fallbackParams.push(minLogP);
      }

      if (excludeMissingGenotype) {
        fallbackFilters.push("(gc.strongest_snp_risk_allele IS NOT NULL AND gc.strongest_snp_risk_allele != '' AND gc.strongest_snp_risk_allele != '?' AND gc.strongest_snp_risk_allele != 'NR' AND gc.strongest_snp_risk_allele NOT LIKE '%?%')");
      }

      const fallbackWhereClause = fallbackFilters.length ? `WHERE ${fallbackFilters.join(" AND ")}` : "";

      // Build order by based on sort parameter
      let fallbackOrderBy = "";
      if (sort === "power") {
        fallbackOrderBy = `ORDER BY CAST(gc.initial_sample_size AS INTEGER) ${direction}`;
      } else if (sort === "recent") {
        fallbackOrderBy = `ORDER BY gc.date ${direction}`;
      } else if (sort === "alphabetical") {
        fallbackOrderBy = `ORDER BY gc.study ${direction}`;
      } else {
        // Default: relevance (sort by -log10(p))
        fallbackOrderBy = `ORDER BY CAST(gc.pvalue_mlog AS REAL) ${direction}`;
      }

      const fallbackQuery = `SELECT ${idSelection},
       gc.study_accession,
       gc.study,
       gc.disease_trait,
       gc.mapped_trait,
       gc.mapped_trait_uri,
       gc.mapped_gene,
       gc.first_author,
       gc.date,
       gc.journal,
       gc.pubmedid,
       gc.link,
       gc.initial_sample_size,
       gc.replication_sample_size,
       gc.p_value,
       gc.pvalue_mlog,
       gc.or_or_beta,
       gc.risk_allele_frequency,
       gc.strongest_snp_risk_allele,
       gc.snps
    FROM gwas_catalog gc
    ${fallbackWhereClause}
    ${fallbackOrderBy}`;

      const fallbackFinalQuery = dbType === 'postgres'
        ? `${fallbackQuery}\n    LIMIT ${rawLimit} OFFSET ${offset}`
        : `${fallbackQuery}\n    LIMIT ? OFFSET ?`;

      rawRows = dbType === 'postgres'
        ? await executeQuery<RawStudy>(fallbackFinalQuery, fallbackParams)
        : await executeQuery<RawStudy>(fallbackFinalQuery, [...fallbackParams, rawLimit, offset]);
    } else {
      // Re-throw if it's a different error
      throw error;
    }
  }

  try {

  const studies: Study[] = rawRows
    .map((row, index) => {
      const sampleSize = parseSampleSize(row.initial_sample_size) ?? parseSampleSize(row.replication_sample_size);
      const pValueNumeric = parsePValue(row.p_value);
      const logPValue = parseLogPValue(row.pvalue_mlog) ?? (pValueNumeric ? -Math.log10(pValueNumeric) : null);
      const qualityFlags = computeQualityFlags(sampleSize, pValueNumeric, logPValue);
      const hasMajorFlags = qualityFlags.some(f => f.severity === 'major');
      const isLowQuality = hasMajorFlags; // Only major flags indicate truly low quality
      const confidenceBand = determineConfidenceBand(sampleSize, pValueNumeric, logPValue, qualityFlags);
      const publicationDate = parseStudyDate(row.date);

      // Check if study is analyzable (has all required fields for risk calculation)
      const isAnalyzable = !!(
        row.snps && row.snps !== '' &&
        row.or_or_beta && row.or_or_beta !== '' &&
        row.strongest_snp_risk_allele && row.strongest_snp_risk_allele !== ''
      );

      const nonAnalyzableReason = !isAnalyzable
        ? (!row.snps || row.snps === '' ? 'Missing SNP data' :
           !row.or_or_beta || row.or_or_beta === '' ? 'Missing effect size (OR/beta)' :
           !row.strongest_snp_risk_allele || row.strongest_snp_risk_allele === '' ? 'Missing risk allele' :
           'Missing required data')
        : undefined;

      return {
        ...row,
        sampleSize,
        sampleSizeLabel: formatNumber(sampleSize),
        pValueNumeric,
        pValueLabel: formatPValue(pValueNumeric),
        logPValue,
        qualityFlags,
        isLowQuality,
        confidenceBand,
        publicationDate,
        isAnalyzable,
        nonAnalyzableReason,
      } satisfies Study;
    })
    .filter((row) => {
      // Note: minSampleSize, maxPValue, minLogP, and excludeMissingGenotype are now handled in SQL
      // Only keep filters that require computed fields (excludeLowQuality, confidenceBand)
      if (excludeLowQuality && row.isLowQuality) {
        return false;
      }
      if (confidenceBandFilter && row.confidenceBand !== confidenceBandFilter) {
        return false;
      }
      return true;
    });

    // Get source count (may fail if numeric overflow in WHERE clause, that's ok)
    let sourceCount = 0;
    try {
      const countQuery = useSemanticQuery && dbType === 'postgres'
        ? `SELECT COUNT(*) as count ${fromClause} ${whereClause}`
        : `SELECT COUNT(*) as count FROM gwas_catalog gc ${whereClause}`;
      const countResult = await executeQuerySingle<{ count: number }>(countQuery, params);
      sourceCount = countResult?.count ?? 0;
    } catch (error: any) {
      console.warn('[Query] Count query failed:', error?.message || 'Unknown error');
      console.warn('[Query] Using result length as count instead');
      sourceCount = rawRows.length;
    }

  const sortedStudies = [...studies];
  const directionFactor = direction === "asc" ? 1 : -1;

  // Skip client-side sorting if semantic search already ordered by relevance
  if (!useSemanticQuery) {
    switch (sort) {
      case "power":
        sortedStudies.sort((a, b) => directionFactor * ((a.sampleSize ?? 0) - (b.sampleSize ?? 0)));
        break;
      case "recent":
        sortedStudies.sort((a, b) => {
          const aDate = a.publicationDate;
          const bDate = b.publicationDate;
          if (aDate === null && bDate === null) {
            return 0;
          }
          if (aDate === null) {
            return 1;
          }
          if (bDate === null) {
            return -1;
          }
          return directionFactor * (aDate - bDate);
        });
        break;
      case "alphabetical":
        sortedStudies.sort(
          (a, b) => (a.study ?? "").localeCompare(b.study ?? "") * directionFactor,
        );
        break;
      default:
        sortedStudies.sort((a, b) => directionFactor * ((a.logPValue ?? -Infinity) - (b.logPValue ?? -Infinity)));
        break;
    }
  }

  const finalResults = sortedStudies.slice(0, limit);

  // For Run All queries, return minimal payload to avoid JSON serialization limits
  if (isRunAllQuery) {
    const minimalResults = finalResults.map(s => ({
      id: s.id,
      study_accession: s.study_accession,
      disease_trait: s.disease_trait,
      study: s.study,
      snps: s.snps,
      strongest_snp_risk_allele: s.strongest_snp_risk_allele,
      or_or_beta: s.or_or_beta,
    }));

    return NextResponse.json({
      data: minimalResults,
      total: studies.length,
      limit,
      truncated: studies.length > finalResults.length,
      sourceCount,
    });
  }

    return NextResponse.json({
      data: finalResults,
      total: studies.length,
      limit,
      truncated: studies.length > finalResults.length,
      sourceCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query database";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
