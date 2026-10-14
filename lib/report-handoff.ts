// Passes a generated report to the DNA Chat page in memory. Reports contain
// genetic interpretations, so they are never written to browser storage.

let pendingReport: string | null = null;

export function setPendingReport(report: string) {
  pendingReport = report;
}

// Returns the pending report once, then clears it
export function takePendingReport(): string | null {
  const report = pendingReport;
  pendingReport = null;
  return report;
}
