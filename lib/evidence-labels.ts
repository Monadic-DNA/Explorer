import type { SavedResult } from "./results-manager";

function parsePValue(result: Pick<SavedResult, "pValue" | "pValueMlog">): number | null {
  if (result.pValue) {
    const normalized = result.pValue.replace(/\s/g, "").replace(/x10\^/i, "e");
    const value = Number.parseFloat(normalized);
    if (Number.isFinite(value) && value > 0) return value;
  }

  if (result.pValueMlog) {
    const mlog = Number.parseFloat(result.pValueMlog);
    if (Number.isFinite(mlog) && mlog > 0) return Math.pow(10, -mlog);
  }

  return null;
}

function parseLargestNumber(value?: string): number | null {
  if (!value) return null;
  const matches = value.match(/\d[\d,]*/g);
  if (!matches?.length) return null;
  const values = matches
    .map((match) => Number.parseInt(match.replace(/,/g, ""), 10))
    .filter((number) => Number.isFinite(number));
  if (!values.length) return null;
  return Math.max(...values);
}

export function getEvidenceBand(result: SavedResult): "strong" | "moderate" | "limited" {
  const pValue = parsePValue(result);
  const sampleSize = parseLargestNumber(result.sampleSize);
  const hasReplication = !!result.replicationSampleSize?.trim();

  if ((pValue !== null && pValue <= 5e-8) && (hasReplication || (sampleSize !== null && sampleSize >= 10000))) {
    return "strong";
  }

  if ((pValue !== null && pValue <= 5e-8) || (sampleSize !== null && sampleSize >= 10000)) {
    return "moderate";
  }

  return "limited";
}

export function getEvidenceLabel(result: SavedResult): string {
  const band = getEvidenceBand(result);
  if (band === "strong") return "Stronger GWAS evidence";
  if (band === "moderate") return "Moderate GWAS evidence";
  return "Limited context available";
}

export function getEvidenceDetails(result: SavedResult): string[] {
  const details: string[] = [];
  const pValue = parsePValue(result);

  if (pValue !== null) {
    details.push(pValue <= 5e-8 ? "Genome-wide significant p-value" : "Association p-value reported");
  }

  if (result.sampleSize) {
    details.push(`Initial sample: ${result.sampleSize}`);
  }

  if (result.replicationSampleSize) {
    details.push(`Replication sample: ${result.replicationSampleSize}`);
  }

  if (result.effectType === "beta") {
    details.push("Beta effect, not an odds ratio");
  } else {
    details.push("Odds ratio is relative, not absolute risk");
  }

  details.push("Educational interpretation, not diagnosis");
  return details;
}
