import { executeQuery } from "@/lib/db";
import {
  computeQualityFlags,
  formatNumber,
  formatPValue,
  parseLogPValue,
  parsePValue,
  parseSampleSize,
} from "@/lib/parsing";

type ConfidenceBand = "high" | "medium" | "low";

export type StudyData = {
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
  ci_text: string | null;
  risk_allele_frequency: string | null;
  strongest_snp_risk_allele: string | null;
  snps: string | null;
  sampleSize: number | null;
  sampleSizeLabel: string;
  pValueNumeric: number | null;
  pValueLabel: string;
  logPValue: number | null;
  qualityFlags: Array<{ message: string; severity: string }>;
  isLowQuality: boolean;
  confidenceBand: ConfidenceBand;
  publicationDate: number | null;
  isAnalyzable: boolean;
  nonAnalyzableReason?: string;
};

type RawRow = {
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
  ci_text: string | null;
  risk_allele_frequency: string | null;
  strongest_snp_risk_allele: string | null;
  snps: string | null;
};

function determineConfidenceBand(
  sampleSize: number | null,
  pValue: number | null,
  logPValue: number | null,
  qualityFlags: Array<{ severity: string }>,
): ConfidenceBand {
  const hasMajorFlags = qualityFlags.some(f => f.severity === "major");
  if (hasMajorFlags) return "low";
  const meetsHigh =
    sampleSize !== null && sampleSize >= 5000 &&
    logPValue !== null && logPValue >= 9 &&
    (pValue === null || pValue <= 5e-9);
  if (meetsHigh) return "high";
  const meetsMedium =
    ((sampleSize ?? 0) >= 2000 || (logPValue ?? 0) >= 7) &&
    (pValue === null || pValue <= 1e-6);
  if (meetsMedium) return "medium";
  return "low";
}

function parsePublicationDate(value: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value.trim());
  return Number.isNaN(ts) ? null : ts;
}

export async function fetchStudyById(studyId: number): Promise<StudyData | null> {
  const rows = await executeQuery<RawRow>(
    `SELECT id, study_accession, study, disease_trait, mapped_trait,
            mapped_trait_uri, mapped_gene, first_author, date, journal,
            pubmedid, link, initial_sample_size, replication_sample_size,
            p_value, pvalue_mlog, or_or_beta, ci_text, risk_allele_frequency,
            strongest_snp_risk_allele, snps
     FROM gwas_catalog WHERE id = $1 LIMIT 1`,
    [studyId],
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  const sampleSize = parseSampleSize(row.initial_sample_size) ?? parseSampleSize(row.replication_sample_size);
  const pValueNumeric = parsePValue(row.p_value);
  const logPValue = parseLogPValue(row.pvalue_mlog) ?? (pValueNumeric ? -Math.log10(pValueNumeric) : null);
  const qualityFlags = computeQualityFlags(sampleSize, pValueNumeric, logPValue);
  const isLowQuality = qualityFlags.some(f => f.severity === "major");
  const confidenceBand = determineConfidenceBand(sampleSize, pValueNumeric, logPValue, qualityFlags);
  const publicationDate = parsePublicationDate(row.date);
  const isAnalyzable = !!(row.snps && row.or_or_beta && row.strongest_snp_risk_allele);
  const nonAnalyzableReason = !isAnalyzable
    ? (!row.snps ? "Missing SNP data" : !row.or_or_beta ? "Missing effect size (OR/beta)" : "Missing risk allele")
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
  };
}
