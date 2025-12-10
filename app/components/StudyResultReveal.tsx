"use client";

import { useState, useEffect, useMemo } from "react";
import { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { hasMatchingSNPs } from "@/lib/snp-utils";
import { analyzeStudyClientSide, UserStudyResult, determineEffectTypeAndSize } from "@/lib/risk-calculator";
import DisclaimerModal from "./DisclaimerModal";
import LLMCommentaryModal from "./LLMCommentaryModal";
import { SavedResult } from "@/lib/results-manager";
import { trackStudyResultReveal } from "@/lib/analytics";

type StudyResultRevealProps = {
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

export default function StudyResultReveal({ studyId, studyAccession, snps, traitName, studyTitle, riskAllele, orOrBeta, ciText, isAnalyzable, nonAnalyzableReason }: StudyResultRevealProps) {
  const { genotypeData, isUploaded } = useGenotype();
  const { addResult, hasResult, getResult, getResultByGwasId, resultsVersion } = useResults();
  const [result, setResult] = useState<UserStudyResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showCommentary, setShowCommentary] = useState(false);

  // Memoize modal props - must be at top level before any conditional returns
  const currentResultForModal = useMemo(() => {
    if (!result?.hasMatch) return null;
    return {
      studyId,
      gwasId: studyAccession || '',
      traitName,
      studyTitle,
      userGenotype: result.userGenotype!,
      riskAllele: result.riskAllele!,
      effectSize: result.effectSize!,
      effectType: result.effectType,
      riskScore: result.riskScore!,
      riskLevel: result.riskLevel!,
      matchedSnp: result.matchedSnp!,
      analysisDate: new Date().toISOString(),
    };
  }, [result, studyId, studyAccession, traitName, studyTitle]);

  // Check if we already have a saved result
  // Both individual reveals and Run All set studyId correctly, so we only need to check by studyId
  // This prevents cross-contamination when multiple catalog rows share the same study_accession
  const savedResult = useMemo(() => {
    return hasResult(studyId) ? getResult(studyId) : undefined;
  }, [studyId, resultsVersion, hasResult, getResult]);

  useEffect(() => {
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
      // Reset if result was removed
      setResult(null);
      setIsRevealed(false);
    }
  }, [savedResult]);

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
    if (!genotypeData) {
      console.error('[StudyResultReveal] No genotype data available');
      setError('No genetic data loaded. Please upload your DNA file first.');
      return;
    }

    if (!snps || !riskAllele) {
      setError('Missing study data required for analysis');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Determine effect type and size from ci_text (client-side, instant)
      const { effectType, effectSize } = determineEffectTypeAndSize(orOrBeta, ciText || null);

      // Perform analysis entirely client-side
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

      // Track result reveal
      trackStudyResultReveal(
        analysisResult.hasMatch,
        analysisResult.hasMatch ? 1 : 0,
        'unknown' // confidenceBand not available here but not critical
      );

      // Save the result (including non-matches) so we don't re-analyze on reload
      // For non-matches, we store minimal info to indicate "already checked, no match"
      if (analysisResult.hasMatch) {
        const savedResult: SavedResult = {
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
        await addResult(savedResult);
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
      // For beta coefficients, show the actual beta value in original units
      return `β=${score >= 0 ? '+' : ''}${score.toFixed(3)} units`;
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
          No match found - your DNA is unique here
        </div>
      );
    }

    return (
      <>
        {showCommentary && currentResultForModal && (
          <LLMCommentaryModal
            isOpen={showCommentary}
            onClose={() => setShowCommentary(false)}
            currentResult={currentResultForModal}
            allResults={[]}
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
            onClick={() => {
              console.log('[StudyResultReveal] Private LLM Analysis button clicked');
              setShowCommentary(true);
              console.log('[StudyResultReveal] showCommentary set to true');
            }}
            title="Get private LLM analysis powered by Nillion's nilAI. Your data is processed securely in a Trusted Execution Environment and is not visible to Monadic DNA."
          >
            🛡️ Private LLM Analysis
          </button>
        </div>
      </>
    );
  }

  // Show appropriate message if no user data or no matching SNPs
  if (!isUploaded) {
    return null; // No data uploaded yet - don't show anything
  }

  // Check if study is analyzable (has required data)
  if (isAnalyzable === false) {
    return (
      <div
        className="user-result not-analyzable"
        title={nonAnalyzableReason || 'This study cannot be analyzed due to missing data'}
      >
        ⚠️ {nonAnalyzableReason || 'Not analyzable'}
      </div>
    );
  }

  // LOOSE MODE: Show "Reveal your match" button if user has ANY SNP from the study
  // Strict allele checking happens later in analyzeStudyClientSide() during actual calculation
  if (!hasMatchingSNPs(genotypeData, snps, null, false)) {
    return (
      <div className="user-result no-match" title="Your genetic data file does not contain any of the SNP variants tested in this study.">
        No data
      </div>
    );
  }

  // Show error if analysis failed
  if (error) {
    return (
      <div className="user-result error" title={error}>
        Error: {error}
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
        {isLoading ? 'Calculating...' : 'Reveal your match'}
      </button>
    </>
  );
}
