import { coreCall } from "./core";

export function parseSampleSize(text?: string | null): number | null { return coreCall("parse_sample_size", text ?? ""); }
export function parsePValue(raw?: string | null): number | null { return coreCall("parse_p_value", raw ?? ""); }
export function parseLogPValue(raw?: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}
export type QualityFlag = {
  message: string;
  severity: 'major' | 'minor';
};

export function computeQualityFlags(sampleSize: number | null, pValue: number | null, logPValue: number | null): QualityFlag[] {
  return coreCall("quality_flags", { sampleSize, pValue, logPValue });
}
// Locale-specific presentation remains a UI responsibility.
export function formatNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

export function formatPValue(value: number | null): string {
  if (value === null) {
    return "-";
  }
  if (value === 0) {
    return "0";
  }
  if (value < 1e-6) {
    return value.toExponential(2);
  }
  return value.toPrecision(2);
}
