// Cache parsed SNP strings to avoid re-parsing same strings
const snpParseCache = new Map<string, string[]>();

export function parseVariantIds(snps: string | null): string[] {
  if (!snps) return [];

  // Check cache first
  if (snpParseCache.has(snps)) {
    return snpParseCache.get(snps)!;
  }

  const parsed = snps
    .split(/[;,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);

  // Cache result (limit cache size to prevent memory bloat)
  if (snpParseCache.size < 100000) {
    snpParseCache.set(snps, parsed);
  }

  return parsed;
}

export function hasMatchingSNPs(
  genotypeData: Map<string, string> | null,
  snps: string | null,
  riskAllele?: string | null,
  strictMode: boolean = false
): boolean {
  if (!genotypeData || !snps) return false;

  const studySnps = parseVariantIds(snps);

  // LOOSE MODE (strictMode = false): Check if user has ANY SNP from the study
  // Used by StudyResultReveal to determine if "Reveal your match" button should show
  // Strict allele checking happens later during actual calculation
  if (!strictMode) {
    return studySnps.some(snp => genotypeData.has(snp));
  }

  // STRICT MODE (strictMode = true): Check if user has the SPECIFIC SNP with SPECIFIC allele
  // Used by Explore tab "Only my variants" filter to only show studies where user has the exact match
  if (!riskAllele) {
    // No risk allele provided, fall back to loose matching
    return studySnps.some(snp => genotypeData.has(snp));
  }

  // Extract the SNP ID and specific allele from risk allele (e.g., "rs57506806-G" -> ["rs57506806", "G"])
  const riskAlleleParts = riskAllele.split('-');
  const riskSnpId = riskAlleleParts[0];
  const riskAlleleBase = riskAlleleParts[1];

  if (!riskAlleleBase || riskAlleleBase.length !== 1) {
    // Invalid risk allele format, fall back to SNP presence check
    return studySnps.some(snp => genotypeData.has(snp));
  }

  // Check if user has the specific SNP mentioned in the risk allele
  // AND carries that specific allele
  const userGenotype = genotypeData.get(riskSnpId);
  if (!userGenotype) return false;

  // User must have the specific allele for the specific SNP
  return userGenotype.includes(riskAlleleBase);
}

export function getMatchingSNPs(genotypeData: Map<string, string> | null, snps: string | null): string[] {
  if (!genotypeData || !snps) return [];
  
  const studySnps = parseVariantIds(snps);
  return studySnps.filter(snp => genotypeData.has(snp));
}
