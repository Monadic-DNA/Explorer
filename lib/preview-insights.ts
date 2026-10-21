import { coreCall } from "./core";
import type { SavedResult } from "./results-manager";

type PreviewCategory =
  | "body_composition"
  | "cardiometabolic"
  | "immune"
  | "brain_behavior"
  | "sleep_energy"
  | "reproductive"
  | "appearance"
  | "medication"
  | "other";

export type PreviewInsight = {
  themes: { label: string; count: number }[];
  standout: SavedResult | null;
  protectiveCount: number;
  elevatedCount: number;
  headline: string;
};

export function getPreviewCategory(result: SavedResult): { id: PreviewCategory; label: string } { return coreCall("preview_category", result); }
export function formatPreviewEffect(result: SavedResult, compact = false): string {
  if (result.effectType === "beta") {
    return `β=${result.riskScore >= 0 ? "+" : ""}${result.riskScore.toFixed(3)}`;
  }

  if (result.riskLevel === "neutral") return "baseline";
  if (compact) return `${result.riskScore.toFixed(2)}x ${result.riskLevel === "increased" ? "↑" : "↓"}`;
  return `${result.riskScore.toFixed(2)}x ${result.riskLevel === "increased" ? "higher relative odds" : "lower relative odds"}`;
}

export function selectAhaPreviewResults(results: SavedResult[], limit = 12): SavedResult[] { return coreCall("preview_select", { results, limit }); }
export function buildPreviewInsight(results: SavedResult[]): PreviewInsight { return coreCall("preview_insight", results); }
