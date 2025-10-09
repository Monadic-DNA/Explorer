"use client";

import { useState, useEffect } from "react";
import { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { hasMatchingSNPs } from "@/lib/snp-utils";
import { analyzeStudyClientSide, UserStudyResult } from "@/lib/risk-calculator";
import DisclaimerModal from "./DisclaimerModal";
import LLMCommentaryModal from "./LLMCommentaryModal";
import { SavedResult } from "@/lib/results-manager";
import { trackStudyResultReveal } from "@/lib/analytics";

type StudyResultRevealProps = {
  studyId: number;
  snps: string | null;
  traitName: string;
  studyTitle: string;
};

export default function StudyResultReveal({ studyId, snps, traitName, studyTitle }: StudyResultRevealProps) {
  const { genotypeData, isUploaded } = useGenotype();
  const { addResult, hasResult, getResult, savedResults } = useResults();
  const [result, setResult] = useState<UserStudyResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showCommentary, setShowCommentary] = useState(false);

  // Check if we already have a saved result
  useEffect(() => {
    if (hasResult(studyId)) {
      const savedResult = getResult(studyId);
      if (savedResult) {
        setResult({
          hasMatch: true,
          userGenotype: savedResult.userGenotype,
          riskAllele: savedResult.riskAllele,
          effectSize: savedResult.effectSize,
          riskScore: savedResult.riskScore,
          riskLevel: savedResult.riskLevel,
          matchedSnp: savedResult.matchedSnp,
        });
        setIsRevealed(true);
      }
    }
  }, [studyId, hasResult, getResult]);

  const handleRevealClick = () => {
    setShowDisclaimer(true);
  };

  const handleDisclaimerClose = () => {
    setShowDisclaimer(false);
  };

  const handleDisclaimerAccept = () => {
    setShowDisclaimer(false);
    analyzeStudy();
  };

  const analyzeStudy = async () => {
    if (!genotypeData) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch study metadata only (no user data sent to server)
      const response = await fetch('/api/analyze-study', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          studyId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load study data');
      }

      // Perform analysis entirely client-side
      const analysisResult = analyzeStudyClientSide(
        genotypeData,
        data.study.snps,
        data.study.riskAllele,
        data.study.effectSize,
        data.study.gwasId,
        data.study.effectType || 'OR',
        data.study.confidenceInterval
      );

      setResult(analysisResult);
      setIsRevealed(true);

      // Track result reveal
      trackStudyResultReveal(
        analysisResult.hasMatch,
        analysisResult.hasMatch ? 1 : 0,
        data.study.confidenceBand || 'unknown'
      );

      // Save the result if it has a match
      if (analysisResult.hasMatch) {
        const savedResult: SavedResult = {
          studyId,
          gwasId: analysisResult.gwasId,
          traitName,
          studyTitle,
          userGenotype: analysisResult.userGenotype!,
          riskAllele: analysisResult.riskAllele!,
          effectSize: analysisResult.effectSize!,
          riskScore: analysisResult.riskScore!,
          riskLevel: analysisResult.riskLevel!,
          matchedSnp: analysisResult.matchedSnp!,
          analysisDate: new Date().toISOString(),
        };
        addResult(savedResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  };

  const formatRiskScore = (score: number, level: string, effectType?: string) => {
    if (level === 'neutral') return effectType === 'beta' ? 'baseline' : '1.0x';
    if (effectType === 'beta') {
      // For beta coefficients, show the effect size directly, not as a multiplier
      return `β=${score > 1 ? '+' : ''}${(score - 1).toFixed(3)}`;
    }
    return `${score.toFixed(2)}x`;
  };

  const generateTooltip = (result: UserStudyResult) => {
    if (!result.hasMatch) return "No genetic data available for this study's variants.";

    const riskScore = result.riskScore!;
    const riskDirection = result.riskLevel!;
    const userGenotype = result.userGenotype!;
    const riskAllele = result.riskAllele!.split('-').pop() || '';
    const effectSize = result.effectSize || '';
    const effectType = result.effectType || 'OR';
    const confidenceInterval = result.confidenceInterval;
    const userAlleles = userGenotype.split('');
    const riskAlleleCount = userAlleles.filter(allele => allele === riskAllele).length;
    const isOddsRatio = effectType === 'OR';

    let baseExplanation = `Your genotype is ${userGenotype}. `;

    // Determine if this is a protective variant (OR < 1)
    const rawEffect = parseFloat(effectSize);
    const isProtective = isOddsRatio && rawEffect < 1;

    if (riskAlleleCount === 0) {
      if (isProtective) {
        baseExplanation += `You don't carry the protective variant (${riskAllele}), which means you lack this genetic protection against the trait. `;
      } else {
        baseExplanation += `You don't carry the risk variant (${riskAllele}), which means this genetic factor doesn't increase your risk for this trait. `;
      }
    } else if (riskAlleleCount === 1) {
      if (isProtective) {
        baseExplanation += `You carry one copy of the protective variant (${riskAllele}), meaning you inherited it from one parent. `;
      } else {
        baseExplanation += `You carry one copy of the risk variant (${riskAllele}), meaning you inherited it from one parent. `;
      }
    } else {
      if (isProtective) {
        baseExplanation += `You carry two copies of the protective variant (${riskAllele}), meaning you inherited it from both parents. `;
      } else {
        baseExplanation += `You carry two copies of the risk variant (${riskAllele}), meaning you inherited it from both parents. `;
      }
    }

    if (riskDirection === 'neutral') {
      baseExplanation += "This genetic variant appears to have no significant effect on your risk.";
    } else if (isOddsRatio) {
      // For odds ratios, we can calculate relative risk changes (but baseline risk matters)
      if (riskDirection === 'increased') {
        const percentChange = ((riskScore - 1) * 100).toFixed(0);

        if (isProtective && riskAlleleCount === 0) {
          // Non-carrier of protective allele
          baseExplanation += `Without this protective variant, your odds are ${percentChange}% higher relative to those who carry it. `;
          baseExplanation += `This means you lack a genetic advantage, though lifestyle and other factors remain important. `;
        } else if (riskScore < 1.5) {
          baseExplanation += `This variant shows a ${percentChange}% relative increase in odds. This is a small effect that may be offset by lifestyle and other genetic factors. `;
        } else if (riskScore < 2.0) {
          baseExplanation += `This variant shows a ${percentChange}% relative increase in odds. Combined with other factors, this could be meaningful for prevention strategies. `;
        } else {
          baseExplanation += `This variant shows a ${percentChange}% relative increase in odds. Consider discussing this with a healthcare provider, especially if you have other risk factors. `;
        }
        baseExplanation += `Important: this percentage reflects relative odds, not absolute risk. The actual impact depends on the baseline population risk (not shown here), confidence intervals, and other genetic/environmental factors.`;
      } else if (riskDirection === 'decreased') {
        const percentChange = ((1 - riskScore) * 100).toFixed(0);
        baseExplanation += `This protective variant reduces your odds by ${percentChange}% relative to non-carriers. This is a favorable genetic factor. Important: this reflects relative odds, not absolute risk reduction. The actual impact depends on baseline population risk and other factors.`;
      }
    } else {
      // For beta coefficients, we cannot convert to percentage risk - describe the effect directionally
      if (riskDirection === 'increased') {
        baseExplanation += `This genetic variant is associated with higher values for this trait. The effect size indicates a per-allele increase, though this does not directly translate to a percentage risk change. Clinical significance depends on the trait's measurement scale and other factors.`;
      } else if (riskDirection === 'decreased') {
        baseExplanation += `This genetic variant is associated with lower values for this trait. The effect size indicates a per-allele decrease, though this does not directly translate to a percentage risk change. Clinical significance depends on the trait's measurement scale and other factors.`;
      }
    }

    baseExplanation += ` Remember that genetics is just one piece of the puzzle - lifestyle, environment, and other genetic variants all play important roles.`;

    return baseExplanation;
  };

  if (isRevealed && result) {
    if (!result.hasMatch) {
      return (
        <div className="user-result no-match">
          No genetic data match
        </div>
      );
    }

    const savedResult = getResult(studyId);

    return (
      <>
        {savedResult && (
          <LLMCommentaryModal
            isOpen={showCommentary}
            onClose={() => setShowCommentary(false)}
            currentResult={savedResult}
            allResults={savedResults}
          />
        )}
        <div className="result-with-commentary">
          <div
            className={`user-result has-match risk-${result.riskLevel}`}
            title={generateTooltip(result)}
          >
            <div className="user-genotype">
              Your genotype: <span className="genotype-value">{result.userGenotype}</span>
            </div>
            <div className={`risk-score risk-${result.riskLevel}`}>
              {formatRiskScore(result.riskScore!, result.riskLevel!, result.effectType)}
              <span className="risk-label">
                {result.riskLevel === 'increased' ? '↑' : result.riskLevel === 'decreased' ? '↓' : '→'}
              </span>
            </div>
          </div>
          <button
            className="commentary-button"
            onClick={() => setShowCommentary(true)}
            title="Get private AI analysis powered by Nillion's nilAI. Your data is processed securely in a Trusted Execution Environment and is not visible to Monadic DNA."
          >
            🔒 Private AI Analysis
          </button>
        </div>
      </>
    );
  }

  // Show appropriate message if no user data or no matching SNPs
  if (!isUploaded) {
    return null; // No data uploaded yet - don't show anything
  }

  if (!hasMatchingSNPs(genotypeData, snps)) {
    return (
      <div className="user-result no-match" title="Your genetic data file does not contain the SNP variants tested in this study.">
        No data
      </div>
    );
  }

  return (
    <>
      <DisclaimerModal
        isOpen={showDisclaimer}
        onClose={handleDisclaimerClose}
        type="result"
        onAccept={handleDisclaimerAccept}
      />
      <button
        className="reveal-button"
        onClick={handleRevealClick}
        disabled={isLoading}
      >
        {isLoading ? '...' : 'Your result'}
      </button>
    </>
  );
}
