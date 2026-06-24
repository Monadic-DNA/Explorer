export type GenotypeData = {
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
};

export type ParseResult = {
  success: boolean;
  data?: GenotypeData[];
  error?: string;
  totalVariants?: number;
  validVariants?: number;
  detectedFormat?: 'monadic' | '23andme' | 'ancestrydna';
};

// Chromosome 26 = mitochondrial in AncestryDNA exports.
const VALID_CHROMOSOMES = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22',
  'X', 'Y', 'MT', 'M', '26',
]);

const VALID_BASES = new Set(['A', 'T', 'G', 'C', 'I', 'D', '0', '-']);

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function stripQuotes(value: string): string {
  // Remove all quote characters — DNA field values (rsid, chr, position, allele) never contain quotes.
  return value.trim().replace(/"/g, '');
}

export function parse23andMeFile(content: string): ParseResult {
  try {
    const lines = splitLines(content);
    const genotypeData: GenotypeData[] = [];
    let totalVariants = 0;
    let validVariants = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      totalVariants++;
      const parts = trimmedLine.split(/\s+/);

      if (parts.length < 4) continue;

      const [rsid, chromosome, positionStr] = parts;
      let genotype = parts[3];

      // Some providers (e.g. LivingDNA alt format) output allele1 allele2 as separate columns.
      // Combine single-char alleles into a 2-char genotype.
      if (parts.length >= 5 && genotype.length === 1 && parts[4].length === 1) {
        genotype = genotype + parts[4];
      }

      if (!rsid.startsWith('rs')) continue;

      if (!VALID_CHROMOSOMES.has(chromosome)) continue;

      const position = parseInt(positionStr, 10);
      if (!Number.isInteger(position) || position <= 0) continue;

      // Normalize no-calls
      if (genotype === '--' || genotype === '-') {
        genotypeData.push({ rsid, chromosome, position, genotype: '--' });
        validVariants++;
        continue;
      }

      if (genotype.length !== 2) continue;
      const validSnpBases = new Set(['A', 'T', 'G', 'C', 'I', 'D', '-']);
      if (!validSnpBases.has(genotype[0]) || !validSnpBases.has(genotype[1])) continue;

      genotypeData.push({ rsid, chromosome, position, genotype });
      validVariants++;
    }

    if (validVariants === 0) {
      return {
        success: false,
        error: 'No valid genotype data found in file. Please ensure the file is in 23andMe format.',
      };
    }

    return { success: true, data: genotypeData, totalVariants, validVariants, detectedFormat: '23andme' };
  } catch (error) {
    return { success: false, error: `Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export function parseMonadicDNAFile(content: string): ParseResult {
  try {
    const lines = splitLines(content);
    const genotypeData: GenotypeData[] = [];
    let totalVariants = 0;
    let validVariants = 0;
    let headerFound = false;
    let delimiter = ',';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      if (!headerFound) {
        const upper = trimmedLine.toUpperCase().replace(/"/g, '');
        const normalized = upper.replace(/\s+/g, '\t');
        const hasExplicitDelimiter = upper.includes(',') || upper.includes('\t');
        // Accept RSID,CHROMOSOME,POSITION,RESULT or RSID,CHROMOSOME,POSITION,GENOTYPE
        // For tab/space headers, require at least one real delimiter so purely
        // space-separated files fall through to the 23andMe whitespace parser instead.
        if (
          upper.startsWith('RSID,CHROMOSOME,POSITION,RESULT') ||
          upper.startsWith('RSID,CHROMOSOME,POSITION,GENOTYPE') ||
          (hasExplicitDelimiter && normalized.startsWith('RSID\tCHROMOSOME\tPOSITION\tGENOTYPE')) ||
          (hasExplicitDelimiter && normalized.startsWith('RSID\tCHROMOSOME\tPOSITION\tRESULT'))
        ) {
          headerFound = true;
          delimiter = trimmedLine.includes('\t') ? '\t' : ',';
          continue;
        }
        continue;
      }

      totalVariants++;
      const parts = trimmedLine.split(delimiter).map(stripQuotes);

      if (parts.length < 4) continue;

      const [rsid, chromosome, positionStr, genotype] = parts;

      if (!rsid.startsWith('rs')) continue;

      const position = parseInt(positionStr, 10);
      if (!Number.isInteger(position) || position < 0) continue;

      if (genotype.length !== 2) continue;

      const validBases = new Set(['A', 'T', 'G', 'C', '-']);
      if (!validBases.has(genotype[0]) || !validBases.has(genotype[1])) continue;

      genotypeData.push({
        rsid,
        chromosome: chromosome === '0' ? '0' : chromosome,
        position,
        genotype,
      });

      validVariants++;
    }

    if (!headerFound) {
      return { success: false, error: 'No valid Monadic DNA header found. Expected: RSID,CHROMOSOME,POSITION,RESULT' };
    }

    if (validVariants === 0) {
      return { success: false, error: 'No valid genotype data found in file. Please ensure the file is in Monadic DNA format.' };
    }

    return { success: true, data: genotypeData, totalVariants, validVariants, detectedFormat: 'monadic' };
  } catch (error) {
    return { success: false, error: `Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export function parseAncestryDNAFile(content: string): ParseResult {
  try {
    const lines = splitLines(content);
    const genotypeData: GenotypeData[] = [];
    let totalVariants = 0;
    let validVariants = 0;
    let headerFound = false;
    let allele1Idx = 3;
    let allele2Idx = 4;
    let delimiter = '\t';

    const configureFromHeader = (headerLine: string) => {
      delimiter = headerLine.includes('\t') ? '\t' : ',';
      const cols = headerLine.split(delimiter).map(c => stripQuotes(c).toLowerCase());
      allele1Idx = cols.findIndex(c => /allele.?1|allele$/.test(c));
      allele2Idx = cols.findIndex(c => /allele.?2/.test(c));
      if (allele1Idx === -1) allele1Idx = 3;
      if (allele2Idx === -1) allele2Idx = 4;
    };

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      if (!headerFound) {
        if (trimmedLine.startsWith('#')) {
          // FTDNA famfinder puts the column header inside a comment line.
          // Only treat it as a header if it contains "allele" (to avoid matching 23andMe comment headers).
          const commentContent = trimmedLine.slice(1).trim();
          const lower = commentContent.toLowerCase();
          if (
            (lower.includes('rsid') || lower.includes('name')) &&
            lower.includes('chromosome') &&
            lower.includes('position') &&
            lower.includes('allele')
          ) {
            headerFound = true;
            configureFromHeader(commentContent);
          }
          continue;
        }

        const lower = trimmedLine.toLowerCase();
        if (lower.includes('rsid') && lower.includes('chromosome') && lower.includes('position')) {
          headerFound = true;
          configureFromHeader(trimmedLine);
          continue;
        }
        continue;
      }

      totalVariants++;
      // Split and filter out empty fields caused by inconsistent multi-separator usage.
      const rawParts = trimmedLine.split(delimiter).map(p => stripQuotes(p));
      const parts = rawParts.filter(p => p !== '');

      if (parts.length <= Math.max(allele1Idx, 2)) continue;

      const rsid = parts[0];
      const chromosome = parts[1];
      const positionStr = parts[2];
      const allele1Raw = parts[allele1Idx] ?? '';
      const allele2Raw = allele2Idx < parts.length ? (parts[allele2Idx] ?? '') : '';

      // If no allele2 but allele1 is 2 chars, treat it as a combined genotype (generic 4-col format).
      if (!allele2Raw && allele1Raw.length === 2) {
        const a1 = allele1Raw[0];
        const a2 = allele1Raw[1];
        if (!rsid.startsWith('rs') && !/^\d+$/.test(rsid)) continue;
        if (!VALID_CHROMOSOMES.has(chromosome)) continue;
        const position = parseInt(positionStr, 10);
        if (!Number.isInteger(position) || position <= 0) continue;
        const validBases = new Set(['A', 'T', 'G', 'C', 'I', 'D', '-']);
        if (!validBases.has(a1) || !validBases.has(a2)) continue;
        genotypeData.push({ rsid, chromosome: chromosome === 'M' ? 'MT' : chromosome, position, genotype: allele1Raw });
        validVariants++;
        continue;
      }

      if (!rsid.startsWith('rs') && !/^\d+$/.test(rsid)) continue;
      if (!VALID_CHROMOSOMES.has(chromosome)) continue;

      const position = parseInt(positionStr, 10);
      if (!Number.isInteger(position) || position <= 0) continue;

      const a1 = allele1Raw || '0';
      const a2 = allele2Raw || '0';

      if (!VALID_BASES.has(a1) || !VALID_BASES.has(a2)) continue;

      const genotype = (a1 === '0' || a2 === '0') ? '--' : a1 + a2;

      genotypeData.push({
        rsid,
        chromosome: chromosome === 'M' ? 'MT' : chromosome === '26' ? 'MT' : chromosome,
        position,
        genotype,
      });

      validVariants++;
    }

    if (!headerFound) {
      return {
        success: false,
        error: 'No valid AncestryDNA header found. Expected header with rsid, chromosome, position columns.',
      };
    }

    if (validVariants === 0) {
      return { success: false, error: 'No valid genotype data found in file. Please ensure the file is in AncestryDNA format.' };
    }

    return { success: true, data: genotypeData, totalVariants, validVariants, detectedFormat: 'ancestrydna' };
  } catch (error) {
    return { success: false, error: `Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export function detectAndParseGenotypeFile(content: string): ParseResult {
  // Scan first 50 lines — some files have long comment/metadata sections before the header.
  const lines = splitLines(content).slice(0, 50);

  // Monadic DNA: CSV/TSV with specific header (also matches MyHeritage, FTDNA, generic 4-col formats).
  // Require an explicit tab or comma so purely space-delimited files fall through to the
  // 23andMe whitespace parser rather than being misrouted here with a comma delimiter.
  const hasMonadicHeader = lines.some(line => {
    const upper = line.trim().toUpperCase().replace(/"/g, '');
    const normalized = upper.replace(/\s+/g, '\t');
    const hasExplicitDelimiter = upper.includes(',') || upper.includes('\t');
    return (
      upper.startsWith('RSID,CHROMOSOME,POSITION,RESULT') ||
      upper.startsWith('RSID,CHROMOSOME,POSITION,GENOTYPE') ||
      (hasExplicitDelimiter && normalized.startsWith('RSID\tCHROMOSOME\tPOSITION\tGENOTYPE')) ||
      (hasExplicitDelimiter && normalized.startsWith('RSID\tCHROMOSOME\tPOSITION\tRESULT'))
    );
  });
  if (hasMonadicHeader) {
    return parseMonadicDNAFile(content);
  }

  // AncestryDNA: non-comment header line with rsid + chromosome + position + allele columns.
  // Skip lines starting with # to avoid matching 23andMe's comment-based column header.
  const hasAncestryHeader = lines.some(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return false;
    const lower = trimmed.toLowerCase();
    return lower.includes('rsid') &&
           lower.includes('chromosome') &&
           lower.includes('position');
  });
  if (hasAncestryHeader) {
    return parseAncestryDNAFile(content);
  }

  // 23andMe and compatible formats: comment lines starting with #.
  // But check if the data rows are AncestryDNA-style (5 columns with separate alleles) —
  // FTDNA famfinder puts its column header in a comment line.
  const has23andMeComments = lines.some(line => line.trim().startsWith('#'));
  if (has23andMeComments) {
    // If any comment line looks like an AncestryDNA header (has "allele"), try AncestryDNA first.
    const commentHasAlleleHeader = lines.some(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#')) return false;
      const lower = trimmed.slice(1).toLowerCase();
      return (lower.includes('rsid') || lower.includes('name')) && lower.includes('chromosome') && lower.includes('allele');
    });
    if (commentHasAlleleHeader) {
      const ancestryResult = parseAncestryDNAFile(content);
      if (ancestryResult.success) return ancestryResult;
    }
    return parse23andMeFile(content);
  }

  // Blind fallback.
  const result23andMe = parse23andMeFile(content);
  if (result23andMe.success) return result23andMe;

  const resultAncestry = parseAncestryDNAFile(content);
  if (resultAncestry.success) return resultAncestry;

  const resultMonadic = parseMonadicDNAFile(content);
  if (resultMonadic.success) return resultMonadic;

  return {
    success: false,
    error: 'Unable to detect file format. Supported formats: 23andMe (.txt), AncestryDNA (.txt), or Monadic DNA (.csv)',
  };
}

export function validateFileSize(file: File, maxSizeMB: number = 50): boolean {
  return file.size <= maxSizeMB * 1024 * 1024;
}

export function validateFileFormat(file: File): boolean {
  const validExtensions = ['.txt', '.tsv', '.csv', '.gz'];
  const fileName = file.name.toLowerCase();
  return validExtensions.some(ext => fileName.endsWith(ext));
}
