// Serialization of in-memory genotype and results data for the on-device vault.

import type { SavedResult } from "./results-manager";

export type GenotypeSnapshot = {
  data: Map<string, string>;
  fileHash: string | null;
  originalFileName: string | null;
  originalFileSize: number | null;
  detectedFormat: string | null;
  fileExtension: string | null;
};

type GenotypeMeta = Omit<GenotypeSnapshot, "data"> & { version: 1; count: number };

// Layout: one JSON metadata line, then "rsid\tgenotype" lines. Much smaller and
// faster than JSON-encoding a million map entries.
export function serializeGenotype(snapshot: GenotypeSnapshot): Uint8Array {
  const { data, ...rest } = snapshot;
  const meta: GenotypeMeta = { version: 1, count: data.size, ...rest };
  const lines: string[] = [JSON.stringify(meta)];
  data.forEach((genotype, rsid) => {
    lines.push(`${rsid}\t${genotype}`);
  });
  return new TextEncoder().encode(lines.join("\n"));
}

export function deserializeGenotype(bytes: Uint8Array): GenotypeSnapshot {
  const text = new TextDecoder().decode(bytes);
  const firstBreak = text.indexOf("\n");
  const meta: GenotypeMeta = JSON.parse(firstBreak === -1 ? text : text.slice(0, firstBreak));

  const data = new Map<string, string>();
  // Scan with indexOf instead of split() to avoid allocating an array of a million lines
  let pos = firstBreak === -1 ? text.length : firstBreak + 1;
  while (pos < text.length) {
    const tab = text.indexOf("\t", pos);
    if (tab === -1) break;
    let end = text.indexOf("\n", tab);
    if (end === -1) end = text.length;
    data.set(text.slice(pos, tab), text.slice(tab + 1, end));
    pos = end + 1;
  }

  return {
    data,
    fileHash: meta.fileHash,
    originalFileName: meta.originalFileName,
    originalFileSize: meta.originalFileSize,
    detectedFormat: meta.detectedFormat,
    fileExtension: meta.fileExtension,
  };
}

export function serializeResults(results: SavedResult[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: 1, results }));
}

export function deserializeResults(bytes: Uint8Array): SavedResult[] {
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  return Array.isArray(parsed.results) ? parsed.results : [];
}

// Cheap identity for "has anything changed since the last save"
export function dataFingerprint(fileHash: string | null, results: SavedResult[]): string {
  return `${fileHash ?? ""}|${results.length}|${results.map((r) => `${r.studyId}:${r.analysisDate}`).join(",")}`;
}
