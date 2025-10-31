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

export function hasMatchingSNPs(genotypeData: Map<string, string> | null, snps: string | null): boolean {
  if (!genotypeData || !snps) return false;

  const studySnps = parseVariantIds(snps);
  return studySnps.some(snp => genotypeData.has(snp));
}

export function getMatchingSNPs(genotypeData: Map<string, string> | null, snps: string | null): string[] {
  if (!genotypeData || !snps) return [];
  
  const studySnps = parseVariantIds(snps);
  return studySnps.filter(snp => genotypeData.has(snp));
}
