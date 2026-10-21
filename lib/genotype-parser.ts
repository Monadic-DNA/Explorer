import { coreCall } from "./core";

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
  detectedFormat?: 'monadic' | '23andme' | 'ancestrydna' | 'myheritage' | 'ftdna' | 'livingdna' | 'mapmygenome';
};

// Parsing is implemented once in explorer-core; File is a browser adapter only.
export function parse23andMeFile(content: string): ParseResult { return coreCall("parse_genotype", { content, format: "23andme" }); }
export function parseMonadicDNAFile(content: string): ParseResult { return coreCall("parse_genotype", { content, format: "monadic" }); }
export function parseAncestryDNAFile(content: string): ParseResult { return coreCall("parse_genotype", { content, format: "ancestrydna" }); }
export function parseMapmygenomeFile(content: string): ParseResult { return coreCall("parse_genotype", { content, format: "mapmygenome" }); }
export function detectAndParseGenotypeFile(content: string): ParseResult { return coreCall("parse_genotype", { content }); }

export function validateFileSize(file: File, maxSizeMB: number = 50): boolean {
  return file.size <= maxSizeMB * 1024 * 1024;
}

export function validateFileFormat(file: File): boolean {
  const validExtensions = ['.txt', '.tsv', '.csv', '.gz'];
  const fileName = file.name.toLowerCase();
  return validExtensions.some(ext => fileName.endsWith(ext));
}
