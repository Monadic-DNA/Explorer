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

type CategoryDefinition = {
  id: PreviewCategory;
  label: string;
  keywords: string[];
};

export type PreviewInsight = {
  themes: { label: string; count: number }[];
  standout: SavedResult | null;
  protectiveCount: number;
  elevatedCount: number;
  headline: string;
};

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: "body_composition",
    label: "body composition",
    keywords: ["body mass", "bmi", "weight", "obesity", "height", "adiposity", "waist", "lean mass", "fat mass"],
  },
  {
    id: "cardiometabolic",
    label: "cardiometabolic traits",
    keywords: ["cholesterol", "lipid", "triglyceride", "glucose", "insulin", "diabetes", "blood pressure", "coronary", "heart"],
  },
  {
    id: "immune",
    label: "immune and inflammation",
    keywords: ["immune", "inflammatory", "asthma", "allergy", "eczema", "psoriasis", "arthritis", "celiac", "crohn", "colitis"],
  },
  {
    id: "brain_behavior",
    label: "brain and behavior",
    keywords: ["cognitive", "intelligence", "education", "neuroticism", "depression", "anxiety", "adhd", "risk taking", "alcohol", "smoking"],
  },
  {
    id: "sleep_energy",
    label: "sleep and energy",
    keywords: ["sleep", "chronotype", "morning", "insomnia", "fatigue", "caffeine", "restless"],
  },
  {
    id: "reproductive",
    label: "hormonal and reproductive traits",
    keywords: ["endometriosis", "menopause", "menarche", "testosterone", "estrogen", "fertility", "reproductive", "puberty"],
  },
  {
    id: "appearance",
    label: "visible traits",
    keywords: ["hair", "skin", "eye color", "freckle", "baldness", "pigmentation", "facial", "tooth"],
  },
  {
    id: "medication",
    label: "medication response",
    keywords: ["drug", "medication", "statin", "warfarin", "metformin", "response", "adverse", "pharmacogen"],
  },
];

const GENERIC_TRAIT_WORDS = new Set([
  "stage",
  "type",
  "disease",
  "disorder",
  "condition",
  "measurement",
  "self",
  "reported",
  "adjusted",
  "male",
  "female",
  "men",
  "women",
]);

function normalizeTraitName(traitName: string): string {
  return traitName
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !GENERIC_TRAIT_WORDS.has(word))
    .join(" ")
    .trim();
}

export function getPreviewCategory(result: SavedResult): { id: PreviewCategory; label: string } {
  const text = `${result.traitName} ${result.studyTitle} ${result.mappedGene || ""}`.toLowerCase();
  const match = CATEGORY_DEFINITIONS.find((category) =>
    category.keywords.some((keyword) => text.includes(keyword))
  );

  if (!match) return { id: "other", label: "other traits" };
  return { id: match.id, label: match.label };
}

export function formatPreviewEffect(result: SavedResult, compact = false): string {
  if (result.effectType === "beta") {
    return `β=${result.riskScore >= 0 ? "+" : ""}${result.riskScore.toFixed(3)}`;
  }

  if (result.riskLevel === "neutral") return "baseline";
  if (compact) return `${result.riskScore.toFixed(2)}x ${result.riskLevel === "increased" ? "↑" : "↓"}`;
  return `${result.riskScore.toFixed(2)}x ${result.riskLevel === "increased" ? "higher relative odds" : "lower relative odds"}`;
}

function parseNumeric(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function effectMagnitude(result: SavedResult): number {
  if (result.effectType === "beta") return Math.min(Math.abs(result.riskScore) * 4, 2.5);
  if (result.riskScore <= 0 || result.riskScore > 50) return 0;
  return Math.min(Math.abs(Math.log(result.riskScore)), 2.5);
}

function evidenceScore(result: SavedResult): number {
  const mlog = parseNumeric(result.pValueMlog);
  const sampleText = `${result.sampleSize || ""} ${result.replicationSampleSize || ""}`;
  const sampleNumbers = sampleText.match(/\d[\d,]*/g)?.map((value) => Number.parseInt(value.replace(/,/g, ""), 10)) || [];
  const largestSample = sampleNumbers.length ? Math.max(...sampleNumbers) : 0;

  let score = 0;
  if (mlog !== null) score += Math.min(mlog / 10, 1.5);
  if (largestSample >= 100000) score += 1;
  else if (largestSample >= 10000) score += 0.6;
  if (result.replicationSampleSize) score += 0.4;
  return score;
}

function interestScore(result: SavedResult): number {
  const category = getPreviewCategory(result).id;
  const categoryBoost =
    category === "other" ? 0 :
    category === "appearance" ? 0.25 :
    category === "cardiometabolic" || category === "immune" || category === "medication" ? 1 :
    0.75;
  return effectMagnitude(result) + evidenceScore(result) + categoryBoost;
}

function previewCategoryLimit(category: PreviewCategory): number {
  if (category === "appearance") return 3;
  if (category === "other") return 2;
  return 3;
}

const CATEGORY_DISPLAY_PRIORITY: Record<PreviewCategory, number> = {
  cardiometabolic: 0,
  medication: 1,
  immune: 2,
  sleep_energy: 3,
  reproductive: 4,
  brain_behavior: 5,
  body_composition: 6,
  appearance: 7,
  other: 8,
};

function orderPreviewResultsForDisplay(results: SavedResult[]): SavedResult[] {
  return [...results].sort((a, b) => {
    const categoryDiff = CATEGORY_DISPLAY_PRIORITY[getPreviewCategory(a).id] - CATEGORY_DISPLAY_PRIORITY[getPreviewCategory(b).id];
    if (categoryDiff !== 0) return categoryDiff;
    return interestScore(b) - interestScore(a);
  });
}

export function selectAhaPreviewResults(results: SavedResult[], limit = 12): SavedResult[] {
  const sorted = [...results].sort((a, b) => interestScore(b) - interestScore(a));
  const selected: SavedResult[] = [];
  const seenTraits = new Set<string>();
  const categoryCounts = new Map<PreviewCategory, number>();

  for (const result of sorted) {
    const normalized = normalizeTraitName(result.traitName);
    if (normalized && seenTraits.has(normalized)) continue;

    const category = getPreviewCategory(result).id;
    const categoryLimit = previewCategoryLimit(category);
    if ((categoryCounts.get(category) || 0) >= categoryLimit) continue;

    selected.push(result);
    if (normalized) seenTraits.add(normalized);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    for (const result of sorted) {
      if (selected.some((item) => item.studyId === result.studyId)) continue;
      const normalized = normalizeTraitName(result.traitName);
      if (normalized && seenTraits.has(normalized)) continue;

      const category = getPreviewCategory(result).id;
      if ((categoryCounts.get(category) || 0) >= previewCategoryLimit(category)) continue;

      selected.push(result);
      if (normalized) seenTraits.add(normalized);
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      if (selected.length >= limit) break;
    }
  }

  return orderPreviewResultsForDisplay(selected);
}

export function buildPreviewInsight(results: SavedResult[]): PreviewInsight {
  const categoryCounts = new Map<string, number>();
  for (const result of results) {
    const category = getPreviewCategory(result).label;
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }

  const themes = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => ({ label, count }));

  const standout = [...results]
    .filter((result) => result.riskLevel !== "neutral")
    .sort((a, b) => interestScore(b) - interestScore(a))[0] || results[0] || null;

  const protectiveCount = results.filter((result) => result.riskLevel === "decreased").length;
  const elevatedCount = results.filter((result) => result.riskLevel === "increased").length;

  return {
    themes,
    standout,
    protectiveCount,
    elevatedCount,
    headline: themes.length > 0
      ? `Your first matches point to ${themes.map((theme) => theme.label).join(", ")}.`
      : "Your first matches are ready to explore.",
  };
}
