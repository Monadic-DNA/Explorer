import pako from "pako";
import type { SavedResult } from "./results-manager";

export type OnboardingRunAllProgress = {
  phase: "downloading" | "decompressing" | "analyzing" | "complete" | "error";
  loaded: number;
  total: number;
  elapsedSeconds: number;
  processedStudies: number;
  matchCount: number;
  message: string;
};

const ONBOARDING_CATALOG_URL =
  "https://monadic-dna-explorer.nyc3.digitaloceanspaces.com/gwas_catalog_20251117.tsv.gz";

export async function runAllAnalysisOnboarding(
  genotypeData: Map<string, string>,
  onProgress: (progress: OnboardingRunAllProgress) => void,
  hasResult: (studyId: number) => boolean
): Promise<SavedResult[]> {
  const startTime = Date.now();

  const emitProgress = (progress: Omit<OnboardingRunAllProgress, "elapsedSeconds">) => {
    onProgress({
      ...progress,
      elapsedSeconds: (Date.now() - startTime) / 1000,
    });
  };

  emitProgress({
    phase: "downloading",
    loaded: 0,
    total: 100,
    processedStudies: 0,
    matchCount: 0,
    message: "Downloading the lightweight study catalog for your preview.",
  });

  const response = await fetch(ONBOARDING_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`Failed to download preview catalog: ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Preview catalog download stream was unavailable.");
  }

  let receivedLength = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedLength += value.length;

    emitProgress({
      phase: "downloading",
      loaded: receivedLength,
      total: contentLength || receivedLength,
      processedStudies: 0,
      matchCount: 0,
      message: "Downloading the lightweight study catalog for your preview.",
    });
  }

  const compressed = new Uint8Array(receivedLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  emitProgress({
    phase: "decompressing",
    loaded: 0,
    total: 1,
    processedStudies: 0,
    matchCount: 0,
    message: "Preparing only the columns needed for onboarding.",
  });

  const looksGzipped = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
  const contentEncoding = response.headers.get("content-encoding") || "";
  const shouldDecompress = looksGzipped && !contentEncoding.toLowerCase().includes("gzip");

  let decompressed: Uint8Array;
  if (shouldDecompress) {
    decompressed = pako.ungzip(compressed);
  } else {
    decompressed = compressed;
  }

  const decoder = new TextDecoder("utf-8");

  let headerEndIdx = 0;
  for (let i = 0; i < decompressed.length; i++) {
    if (decompressed[i] === 0x0a || (decompressed[i] === 0x0d && decompressed[i + 1] === 0x0a)) {
      headerEndIdx = i;
      break;
    }
  }

  const headerLine = decoder.decode(decompressed.slice(0, headerEndIdx));
  const headers = headerLine.split("\t");
  const colMap: Record<string, number> = {};
  headers.forEach((header, index) => {
    colMap[header.trim()] = index;
  });

  const idIdx = colMap.id;
  const accessionIdx = colMap.study_accession;
  const traitIdx = colMap.disease_trait;
  const studyIdx = colMap.study;
  const riskAlleleIdx = colMap.strongest_snp_risk_allele;
  const orBetaIdx = colMap.or_or_beta;
  const ciTextIdx = colMap.ci_text;
  const mappedGeneIdx = colMap.mapped_gene;

  if (
    idIdx === undefined ||
    traitIdx === undefined ||
    studyIdx === undefined ||
    riskAlleleIdx === undefined ||
    orBetaIdx === undefined
  ) {
    throw new Error("Preview catalog schema is missing required columns.");
  }

  const estimatedTotalLines = Math.max(1, Math.floor(decompressed.length / 500));
  const chunkSize = 10 * 1024 * 1024;
  let position = headerEndIdx + (decompressed[headerEndIdx] === 0x0d ? 2 : 1);
  let leftover = new Uint8Array(0);
  let processedStudies = 0;
  let matchCount = 0;
  let lastProgressUpdate = Date.now();
  const results: SavedResult[] = [];

  emitProgress({
    phase: "analyzing",
    loaded: 0,
    total: estimatedTotalLines,
    processedStudies: 0,
    matchCount: 0,
    message: "Scanning the preview fields against your uploaded genotypes.",
  });

  while (position < decompressed.length) {
    const chunkEnd = Math.min(position + chunkSize, decompressed.length);
    const chunk = decompressed.slice(position, chunkEnd);
    const combined = new Uint8Array(leftover.length + chunk.length);
    combined.set(leftover);
    combined.set(chunk, leftover.length);

    let lastNewline = combined.length - 1;
    for (let i = combined.length - 1; i >= 0; i--) {
      if (combined[i] === 0x0a) {
        lastNewline = i;
        break;
      }
    }

    const textChunk = decoder.decode(combined.slice(0, lastNewline + 1));
    const lines = textChunk.split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) continue;
      processedStudies++;

      const now = Date.now();
      if (now - lastProgressUpdate >= 250) {
        emitProgress({
          phase: "analyzing",
          loaded: processedStudies,
          total: estimatedTotalLines,
          processedStudies,
          matchCount,
          message: "Scanning the preview fields against your uploaded genotypes.",
        });
        lastProgressUpdate = now;
      }

      const cols = line.split("\t");
      const id = Number.parseInt(cols[idIdx] || "", 10);
      const strongestRiskAllele = cols[riskAlleleIdx]?.trim();
      const effectSize = cols[orBetaIdx]?.trim();

      if (!id || !strongestRiskAllele || !effectSize) {
        continue;
      }

      const [riskSnpId, riskAlleleBase] = strongestRiskAllele.split("-");
      if (!riskSnpId || !riskAlleleBase) continue;

      const userGenotype = genotypeData.get(riskSnpId);
      if (!userGenotype || !/^[ACGT]{2}$/.test(userGenotype) || !userGenotype.includes(riskAlleleBase)) {
        continue;
      }

      const effectValue = Number.parseFloat(effectSize);
      const ciTextLower = (cols[ciTextIdx] || "").toLowerCase();
      const hasIncrease = ciTextLower.includes("increase");
      const hasDecrease = ciTextLower.includes("decrease");
      const effectType: "OR" | "beta" = hasIncrease || hasDecrease ? "beta" : "OR";

      let adjustedEffect = effectValue;
      if (effectType === "beta" && hasDecrease && !hasIncrease) {
        adjustedEffect = -Math.abs(effectValue);
      }

      const riskAlleleCount = userGenotype.split("").filter((base) => base === riskAlleleBase).length;
      let riskScore = 1.0;
      let riskLevel: "increased" | "decreased" | "neutral" = "neutral";

      if (!Number.isNaN(adjustedEffect) && adjustedEffect !== 0) {
        if (effectType === "OR") {
          if (riskAlleleCount > 0) {
            riskScore = Math.pow(adjustedEffect, riskAlleleCount);
            riskLevel = adjustedEffect > 1 ? "increased" : adjustedEffect < 1 ? "decreased" : "neutral";
          }
        } else {
          riskScore = adjustedEffect * riskAlleleCount;
          if (riskAlleleCount > 0) {
            riskLevel = adjustedEffect > 0 ? "increased" : adjustedEffect < 0 ? "decreased" : "neutral";
          }
        }
      }

      if (!hasResult(id)) {
        results.push({
          studyId: id,
          gwasId: cols[accessionIdx] || "",
          traitName: cols[traitIdx] || "Unknown trait",
          studyTitle: cols[studyIdx] || "Unknown study",
          userGenotype,
          riskAllele: strongestRiskAllele,
          effectSize,
          effectType,
          riskScore,
          riskLevel,
          matchedSnp: riskSnpId,
          analysisDate: new Date().toISOString(),
          mappedGene: cols[mappedGeneIdx] || undefined,
        });
        matchCount++;
      }
    }

    leftover = combined.slice(lastNewline + 1);
    position = chunkEnd;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const finalLine = decoder.decode(leftover).trim();
  if (finalLine) {
    processedStudies++;
    const cols = finalLine.split("\t");
    const id = Number.parseInt(cols[idIdx] || "", 10);
    const strongestRiskAllele = cols[riskAlleleIdx]?.trim();
    const effectSize = cols[orBetaIdx]?.trim();

    if (id && strongestRiskAllele && effectSize) {
      const [riskSnpId, riskAlleleBase] = strongestRiskAllele.split("-");
      const userGenotype = riskSnpId ? genotypeData.get(riskSnpId) : undefined;

      if (riskSnpId && riskAlleleBase && userGenotype && /^[ACGT]{2}$/.test(userGenotype) && userGenotype.includes(riskAlleleBase)) {
        const effectValue = Number.parseFloat(effectSize);
        const ciTextLower = (cols[ciTextIdx] || "").toLowerCase();
        const hasIncrease = ciTextLower.includes("increase");
        const hasDecrease = ciTextLower.includes("decrease");
        const effectType: "OR" | "beta" = hasIncrease || hasDecrease ? "beta" : "OR";

        let adjustedEffect = effectValue;
        if (effectType === "beta" && hasDecrease && !hasIncrease) {
          adjustedEffect = -Math.abs(effectValue);
        }

        const riskAlleleCount = userGenotype.split("").filter((base) => base === riskAlleleBase).length;
        let riskScore = 1.0;
        let riskLevel: "increased" | "decreased" | "neutral" = "neutral";

        if (!Number.isNaN(adjustedEffect) && adjustedEffect !== 0) {
          if (effectType === "OR") {
            if (riskAlleleCount > 0) {
              riskScore = Math.pow(adjustedEffect, riskAlleleCount);
              riskLevel = adjustedEffect > 1 ? "increased" : adjustedEffect < 1 ? "decreased" : "neutral";
            }
          } else {
            riskScore = adjustedEffect * riskAlleleCount;
            if (riskAlleleCount > 0) {
              riskLevel = adjustedEffect > 0 ? "increased" : adjustedEffect < 0 ? "decreased" : "neutral";
            }
          }
        }

        if (!hasResult(id)) {
          results.push({
            studyId: id,
            gwasId: cols[accessionIdx] || "",
            traitName: cols[traitIdx] || "Unknown trait",
            studyTitle: cols[studyIdx] || "Unknown study",
            userGenotype,
            riskAllele: strongestRiskAllele,
            effectSize,
            effectType,
            riskScore,
            riskLevel,
            matchedSnp: riskSnpId,
            analysisDate: new Date().toISOString(),
            mappedGene: cols[mappedGeneIdx] || undefined,
          });
          matchCount++;
        }
      }
    }
  }

  emitProgress({
    phase: "complete",
    loaded: processedStudies,
    total: processedStudies,
    processedStudies,
    matchCount,
    message: "Preview analysis complete.",
  });

  return results;
}
