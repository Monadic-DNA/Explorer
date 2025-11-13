export function parseSampleSize(text?: string | null): number | null {
  if (!text) {
    return null;
  }

  // Extract all numbers from the text
  const matches = text.match(/\d[\d,]*/g);
  if (!matches) {
    return null;
  }

  const numbers = matches.map(v => Number(v.replace(/,/g, ""))).filter(n => !Number.isNaN(n) && n > 0);

  if (numbers.length === 0) {
    return null;
  }

  // Heuristic to avoid double-counting:
  // If we have multiple similar numbers (within 20% of each other), they likely represent
  // the same cohort described in different ways. Take the maximum instead of summing.
  // Otherwise, sum them (they're likely distinct sub-cohorts).

  if (numbers.length === 1) {
    return numbers[0];
  }

  const maxNum = Math.max(...numbers);
  const allSimilar = numbers.every(n => Math.abs(n - maxNum) / maxNum < 0.2);

  if (allSimilar) {
    // Likely duplicate descriptions of the same cohort - use the largest
    return maxNum;
  }

  // Different cohorts - sum them
  return numbers.reduce((sum, n) => sum + n, 0);
}

export function parsePValue(raw?: string | null): number | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase().replace(/×/g, "x");

  if (/^\d+(\.\d+)?(e-?\d+)?$/.test(normalized)) {
    const value = Number(normalized);
    return Number.isNaN(value) ? null : value;
  }

  const scientificMatch = normalized.match(/([\d.]+)\s*x\s*10\s*\^\s*(-?\d+)/);
  if (scientificMatch) {
    const base = Number(scientificMatch[1]);
    const exponent = Number(scientificMatch[2]);
    if (!Number.isNaN(base) && !Number.isNaN(exponent)) {
      return base * 10 ** exponent;
    }
  }

  const inequalityMatch = normalized.match(/<\s*([\deE+\-.x^\s]+)/);
  if (inequalityMatch) {
    return parsePValue(inequalityMatch[1]);
  }

  return null;
}

export function parseLogPValue(raw?: string | null): number | null {
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

export type QualityFlag = {
  message: string;
  severity: 'major' | 'minor';
};

export function computeQualityFlags(sampleSize: number | null, pValue: number | null, logPValue: number | null): QualityFlag[] {
  const flags: QualityFlag[] = [];

  // Major flags - seriously questionable
  if (sampleSize !== null && sampleSize < 500) {
    flags.push({
      message: "Very small discovery cohort (<500 participants)",
      severity: 'major'
    });
  }
  if (pValue !== null && pValue > 5e-7) {
    flags.push({
      message: "Association well above genome-wide significance (p > 5e-7)",
      severity: 'major'
    });
  }

  // Minor flags - marginal issues
  if (sampleSize !== null && sampleSize >= 500 && sampleSize < 1000) {
    flags.push({
      message: "Small discovery cohort (500-1000 participants)",
      severity: 'minor'
    });
  }
  if (pValue !== null && pValue > 5e-8 && pValue <= 5e-7) {
    flags.push({
      message: "Association slightly above genome-wide significance (5e-8 < p < 5e-7)",
      severity: 'minor'
    });
  }
  if (logPValue !== null && logPValue < 6) {
    flags.push({
      message: "Moderate signal strength (−log10 p < 6)",
      severity: 'minor'
    });
  }

  return flags;
}

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
