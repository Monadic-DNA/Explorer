export const ONE_TIME_REPORT_PRICE_CENTS = 499;

export const PAID_REPORT_TYPES = ['healthspan', 'top_traits', 'overview'] as const;

export type PaidReportType = typeof PAID_REPORT_TYPES[number];

export const PAID_REPORT_LABELS: Record<PaidReportType, string> = {
  healthspan: 'Healthspan Report',
  top_traits: 'Top Traits Report',
  overview: 'Comprehensive Overview Report',
};

export function isPaidReportType(value: unknown): value is PaidReportType {
  return typeof value === 'string' && (PAID_REPORT_TYPES as readonly string[]).includes(value);
}
