"use client";

import { useState, useLayoutEffect, useMemo } from "react";
import { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { hasMatchingSNPs } from "@/lib/snp-utils";
import { analyzeStudyClientSide, UserStudyResult, determineEffectTypeAndSize } from "@/lib/risk-calculator";
import DisclaimerModal from "./DisclaimerModal";
import { SavedResult } from "@/lib/results-manager";
import { trackStudyResultReveal } from "@/lib/analytics";

type Props = {
  studyId: number;
  studyAccession: string | null;
  snps: string | null;
  traitName: string;
  studyTitle: string;
  riskAllele?: string | null;
  orOrBeta?: string | null;
  ciText?: string | null;
  isAnalyzable?: boolean;
  nonAnalyzableReason?: string;
};

function formatRiskScore(score: number, level: string, effectType?: string): string {
  if (level === "neutral") return effectType === "beta" ? "baseline" : "1.0x";
  if (effectType === "beta") {
    return `β=${score >= 0 ? "+" : ""}${score.toFixed(3)} units`;
  }
  return `${score.toFixed(2)}x`;
}

function generateTooltip(result: UserStudyResult): string {
  if (!result.hasMatch) return "No genetic data available for this study's variants.";

  const riskScore = result.riskScore!;
  const riskDirection = result.riskLevel!;
  const userGenotype = result.userGenotype!;
  const riskAllele = result.riskAllele!.split("-").pop() || "";
  const effectSize = result.effectSize || "";
  const effectType = result.effectType || "OR";
  const userAlleles = userGenotype.split("");
  const riskAlleleCount = userAlleles.filter((a) => a === riskAllele).length;
  const isOddsRatio = effectType === "OR";
  const rawEffect = parseFloat(effectSize);
  const isProtective = isOddsRatio && rawEffect < 1;

  let text = `Your genotype is ${userGenotype}. `;

  if (riskAlleleCount === 0) {
    text += isProtective
      ? `You don't carry the protective variant (${riskAllele}), which means you lack this genetic protection. `
      : `You don't carry the risk variant (${riskAllele}), so this factor doesn't increase your risk. `;
  } else if (riskAlleleCount === 1) {
    text += isProtective
      ? `You carry one copy of the protective variant (${riskAllele}). `
      : `You carry one copy of the risk variant (${riskAllele}). `;
  } else {
    text += isProtective
      ? `You carry two copies of the protective variant (${riskAllele}). `
      : `You carry two copies of the risk variant (${riskAllele}). `;
  }

  if (riskDirection === "neutral") {
    text += "This variant appears to have no significant effect on your risk.";
  } else if (isOddsRatio) {
    if (riskDirection === "increased") {
      const pct = ((riskScore - 1) * 100).toFixed(0);
      text += `This variant is associated with a ${pct}% relative increase in odds. `;
    } else {
      const pct = ((1 - riskScore) * 100).toFixed(0);
      text += `This protective variant reduces your odds by ${pct}% relative to non-carriers. `;
    }
    text += "This reflects relative odds, not absolute risk. Actual impact depends on baseline population risk and other factors.";
  } else {
    text +=
      riskDirection === "increased"
        ? "This variant is associated with higher values for this trait."
        : "This variant is associated with lower values for this trait.";
  }

  return text;
}

export default function StudyPersonalResultBanner({
  studyId,
  studyAccession,
  snps,
  traitName,
  studyTitle,
  riskAllele,
  orOrBeta,
  ciText,
  isAnalyzable,
  nonAnalyzableReason,
}: Props) {
  const { genotypeData, isUploaded } = useGenotype();
  const { addResult, hasResult, getResult, resultsVersion } = useResults();
  const [result, setResult] = useState<UserStudyResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const savedResult = useMemo(() => {
    return hasResult(studyId) ? getResult(studyId) : undefined;
  }, [studyId, resultsVersion, hasResult, getResult]);

  useLayoutEffect(() => {
    if (savedResult) {
      setResult({
        hasMatch: true,
        userGenotype: savedResult.userGenotype,
        riskAllele: savedResult.riskAllele,
        effectSize: savedResult.effectSize,
        effectType: savedResult.effectType,
        riskScore: savedResult.riskScore,
        riskLevel: savedResult.riskLevel,
        matchedSnp: savedResult.matchedSnp,
      });
      setIsRevealed(true);
    } else {
      setResult(null);
      setIsRevealed(false);
    }
  }, [savedResult]);

  const analyzeStudy = async () => {
    if (!genotypeData || !snps || !riskAllele) return;
    setIsLoading(true);
    setError(null);
    try {
      const { effectType, effectSize } = determineEffectTypeAndSize(orOrBeta || null, ciText || null);
      const analysisResult = analyzeStudyClientSide(
        genotypeData,
        snps,
        riskAllele,
        effectSize,
        studyAccession || null,
        effectType,
        ciText || null
      );
      setResult(analysisResult);
      setIsRevealed(true);
      trackStudyResultReveal(analysisResult.hasMatch, analysisResult.hasMatch ? 1 : 0, "unknown");
      if (analysisResult.hasMatch) {
        const toSave: SavedResult = {
          studyId,
          gwasId: analysisResult.gwasId,
          traitName,
          studyTitle,
          userGenotype: analysisResult.userGenotype!,
          riskAllele: analysisResult.riskAllele!,
          effectSize: analysisResult.effectSize!,
          effectType: analysisResult.effectType,
          riskScore: analysisResult.riskScore!,
          riskLevel: analysisResult.riskLevel!,
          matchedSnp: analysisResult.matchedSnp!,
          analysisDate: new Date().toISOString(),
        };
        await addResult(toSave);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsLoading(false);
    }
  };

  // State C — result revealed
  if (isRevealed && result) {
    if (!result.hasMatch) {
      return (
        <div className="study-result-banner study-result-banner--neutral">
          <div className="srb-header">
            <span className="srb-icon">🧬</span>
            <h2 className="srb-title">Your Personal Result</h2>
          </div>
          <p className="srb-no-match">No matching variants found in your DNA data for this study.</p>
        </div>
      );
    }

    return (
      <div className={`study-result-banner study-result-banner--${result.riskLevel}`}>
        <div className="srb-header">
          <span className="srb-icon">🧬</span>
          <h2 className="srb-title">Your Personal Result</h2>
        </div>
        <div className="srb-result-row">
          <div className="srb-genotype">
            <span className="srb-label">Your genotype</span>
            <span className="srb-genotype-value">{result.userGenotype}</span>
          </div>
          <div className="srb-risk">
            <span className="srb-label">Risk score</span>
            <span className={`srb-risk-value srb-risk-value--${result.riskLevel}`}>
              {formatRiskScore(result.riskScore!, result.riskLevel!, result.effectType)}
              <span className="srb-direction">
                {result.riskLevel === "increased" ? " ↑" : result.riskLevel === "decreased" ? " ↓" : " →"}
              </span>
            </span>
          </div>
        </div>
        <p className="srb-explanation">{generateTooltip(result)}</p>
      </div>
    );
  }

  // State A — no DNA uploaded
  if (!isUploaded) {
    return (
      <div className="study-result-banner study-result-banner--cta">
        <div className="srb-header">
          <span className="srb-icon">🧬</span>
          <h2 className="srb-title">See how this study applies to you</h2>
        </div>
        <p className="srb-cta-body">
          Upload your DNA file using the <strong>My Data</strong> button at the top of the page to see your personal result and get a private AI analysis of what it means for you.
        </p>
        <p className="srb-cta-body">
          Need to download your raw data first?{" "}
          <a href="https://monadicdna.com/guide/23andme" target="_blank" rel="noopener noreferrer" className="srb-guide-link">23andMe guide</a>
          {" · "}
          <a href="https://monadicdna.com/guide/ancestry" target="_blank" rel="noopener noreferrer" className="srb-guide-link">AncestryDNA guide</a>
        </p>
      </div>
    );
  }

  // State B — DNA uploaded, not yet revealed
  if (isAnalyzable === false) {
    return (
      <div className="study-result-banner study-result-banner--neutral">
        <div className="srb-header">
          <span className="srb-icon">🧬</span>
          <h2 className="srb-title">Your Personal Result</h2>
        </div>
        <p className="srb-no-match">⚠️ {nonAnalyzableReason || "This study cannot be analyzed due to missing data."}</p>
      </div>
    );
  }

  if (!hasMatchingSNPs(genotypeData, snps, null, false)) {
    return (
      <div className="study-result-banner study-result-banner--neutral">
        <div className="srb-header">
          <span className="srb-icon">🧬</span>
          <h2 className="srb-title">Your Personal Result</h2>
        </div>
        <p className="srb-no-match">Your DNA file does not contain the variants tested in this study.</p>
      </div>
    );
  }

  return (
    <>
      <DisclaimerModal
        isOpen={showDisclaimer}
        onClose={() => setShowDisclaimer(false)}
        type="result"
        onAccept={() => {
          setShowDisclaimer(false);
          analyzeStudy();
        }}
      />
      <div className="study-result-banner study-result-banner--ready">
        <div className="srb-header">
          <span className="srb-icon">🧬</span>
          <h2 className="srb-title">Your Personal Result</h2>
        </div>
        <p className="srb-cta-body">You have DNA data loaded. Reveal your match for this study.</p>
        {error && <p className="srb-error">{error}</p>}
        <button
          className="srb-reveal-button"
          onClick={() => setShowDisclaimer(true)}
          disabled={isLoading}
        >
          {isLoading ? "Calculating…" : "Reveal your match"}
        </button>
      </div>
    </>
  );
}
