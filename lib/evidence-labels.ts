import type { SavedResult } from "./results-manager";
import { coreCall } from "./core";
type Evidence = { band: "strong" | "moderate" | "limited"; label: string; details: string[] };
export function getEvidenceBand(result: SavedResult): Evidence["band"] { return coreCall<Evidence>("evidence", result).band; }
export function getEvidenceLabel(result: SavedResult): string { return coreCall<Evidence>("evidence", result).label; }
export function getEvidenceDetails(result: SavedResult): string[] { return coreCall<Evidence>("evidence", result).details; }
