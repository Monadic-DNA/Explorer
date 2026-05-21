// MOTHBALLED 2026-05-19: The conversion onboarding flow is preserved for reference, but active entry points now use the lightweight new-user choice modal.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SavedResult } from "@/lib/results-manager";
import { runAllAnalysisOnboarding, type OnboardingRunAllProgress } from "@/lib/run-all-onboarding";
import { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import LLMCommentaryModal from "./LLMCommentaryModal";
import NilAIConsentModal from "./NilAIConsentModal";
import { callLLM, getLLMDescription } from "@/lib/llm-client";
import {
  trackAIConsentDeclined,
  trackAIConsentGiven,
  trackLLMQuestionAsked,
  trackOnboardingAction,
  trackOnboardingCompleted,
  trackOnboardingDismissed,
  trackOnboardingPathChosen,
  trackOnboardingStarted,
  trackOnboardingStepViewed,
  trackRunAllCompleted,
  trackRunAllFailed,
  trackRunAllStarted,
  trackSampleDataFailed,
  trackSampleDataLoaded,
  trackSampleDataStarted,
} from "@/lib/analytics";

type FlowMode = "guided" | "instant_preview";
type OnboardingStep = "intro" | "path" | "need_file" | "need_sequencing" | "sample_data" | "upload" | "run_all" | "traits" | "responses";
type CompletionPath = "own_dna" | "own_dna_needs_help" | "own_dna_no_test";

type PreviewChatAnswer = {
  question: string;
  answer: string;
  studiesUsed: number;
};

type SampleLoadPhase = "idle" | "downloading" | "ingesting" | "complete";

type SampleLoadProgress = {
  phase: SampleLoadPhase;
  downloadedBytes: number;
  totalBytes: number;
};

interface ConversionOnboardingProps {
  isOpen: boolean;
  onComplete: () => void;
  onDismiss?: () => void;
  mode?: FlowMode;
}

const CONSENT_STORAGE_KEY = "nilai_llm_consent_accepted";
const SAMPLE_DATA_URL = "/api/sample-genotype";
const GUIDE_23ANDME_URL = "https://monadicdna.com/guide/23andme";
const GUIDE_ANCESTRY_URL = "https://monadicdna.com/guide/ancestry";
const SEQUENCING_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdHFDpsyU0t6PlaXEkbHX-pwF_y7icuPJeOHyGHMDpe11XigQ/viewform?usp=sharing&ouid=117844628488835974298";
const REQUIRED_TRAIT_COUNT = 6;
const CURATED_ONBOARDING_TRAITS = [
  { traitName: "Sleep Quality", gwasId: "GCST012034", matchedSnp: "rs8095104" },
  { traitName: "Spicy food liking", gwasId: "GCST90094846", matchedSnp: "rs6882046" },
  { traitName: "Body Mass Index", gwasId: "GCST004559", matchedSnp: "rs12446632" },
  { traitName: "Aging Rate", gwasId: "GCST011011", matchedSnp: "rs13107325" },
  { traitName: "Facial Skin Hydration", gwasId: "GCST90104592", matchedSnp: "rs79885808" },
  { traitName: "Motion Sickness", gwasId: "GCST002759", matchedSnp: "rs1195218" },
] as const;
const CHAT_PREVIEW_QUESTIONS = [
  "How's my sleep profile?",
  "Which sports are ideal for me?",
  "What kinds of foods do you think I will like best?",
  "Which learning styles are best for me?",
  "What do my genetics imply for my skincare routine?",
];
const HAPPY_PATH_STEP_INDEX: Partial<Record<OnboardingStep, number>> = {
  intro: 1,
  path: 2,
  need_file: 2,
  need_sequencing: 2,
  sample_data: 2,
  upload: 3,
  run_all: 4,
  traits: 5,
  responses: 6,
};

const INITIAL_SAMPLE_LOAD_PROGRESS: SampleLoadProgress = {
  phase: "idle",
  downloadedBytes: 0,
  totalBytes: 0,
};

function dedupeStudyResults(results: SavedResult[]): SavedResult[] {
  const seen = new Set<number>();
  return results.filter((result) => {
    if (seen.has(result.studyId)) return false;
    seen.add(result.studyId);
    return true;
  });
}

function normalizeOnboardingKey(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function formatSampleBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTraitCandidates(results: SavedResult[]): SavedResult[] {
  const deduped = dedupeStudyResults(results);
  return CURATED_ONBOARDING_TRAITS
    .map((target) => {
      const match = deduped.find(
        (result) =>
          normalizeOnboardingKey(result.gwasId) === normalizeOnboardingKey(target.gwasId) &&
          normalizeOnboardingKey(result.matchedSnp) === normalizeOnboardingKey(target.matchedSnp)
      );

      return match
        ? {
            ...match,
            traitName: target.traitName,
          }
        : null;
    })
    .filter((result) => result !== null) as SavedResult[];
}

function formatRiskScore(score: number, level: string, effectType?: string): string {
  if (level === "neutral") return effectType === "beta" ? "baseline" : "1.0x";
  if (effectType === "beta") {
    return `β=${score >= 0 ? "+" : ""}${score.toFixed(3)} units`;
  }
  return `${score.toFixed(2)}x`;
}

function formatRiskHeadline(result: SavedResult): string {
  if (result.effectType === "beta") {
    if (result.riskLevel === "neutral") return "No measurable shift in this study";
    return result.riskLevel === "increased"
      ? "Associated with higher values for this trait"
      : "Associated with lower values for this trait";
  }

  if (result.riskLevel === "neutral" || Math.abs(result.riskScore - 1) < 0.001) {
    return "Baseline odds in this study";
  }

  const delta = result.riskLevel === "increased"
    ? (result.riskScore - 1) * 100
    : (1 - result.riskScore) * 100;
  const formatted = Math.abs(delta).toFixed(Math.abs(delta) >= 10 ? 0 : 1);

  return result.riskLevel === "increased"
    ? `${formatted}% higher relative odds`
    : `${formatted}% lower relative odds`;
}

function getRiskTone(result: SavedResult): "warm" | "cool" | "neutral" {
  if (result.riskLevel === "increased") return "warm";
  if (result.riskLevel === "decreased") return "cool";
  return "neutral";
}

function getProgressTitle(progress: OnboardingRunAllProgress): string {
  switch (progress.phase) {
    case "downloading":
      return "Downloading the preview catalog";
    case "decompressing":
      return "Preparing the onboarding dataset";
    case "analyzing":
      return "Matching your uploaded genotypes";
    case "complete":
      return "Preview analysis complete";
    case "error":
      return "Preview analysis failed";
    default:
      return "Running preview analysis";
  }
}

function getProgressFraction(progress: OnboardingRunAllProgress): number {
  if (progress.phase === "decompressing") return 0.55;
  if (progress.phase === "complete") return 1;
  if (progress.total <= 0) return 0;
  return Math.max(0, Math.min(progress.loaded / progress.total, 1));
}

function getBackStep(step: OnboardingStep, completionPath: CompletionPath): OnboardingStep | null {
  switch (step) {
    case "path":
      return "intro";
    case "need_file":
    case "need_sequencing":
      return "path";
    case "sample_data":
      return completionPath === "own_dna_no_test" ? "need_sequencing" : "need_file";
    case "upload":
      return completionPath === "own_dna" ? "path" : "sample_data";
    case "run_all":
      return "upload";
    case "traits":
      return "run_all";
    case "responses":
      return "traits";
    default:
      return null;
  }
}

export default function ConversionOnboarding({
  isOpen,
  onComplete,
  onDismiss,
  mode = "guided",
}: ConversionOnboardingProps) {
  const { genotypeData, isUploaded, isLoading, error, originalFileName, uploadGenotype } = useGenotype();
  const { addResultsBatch, savedResults, getTopResultsByRelevance } = useResults();

  const [mounted, setMounted] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("intro");
  const [completionPath, setCompletionPath] = useState<CompletionPath>("own_dna");
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [traitCandidates, setTraitCandidates] = useState<SavedResult[]>([]);
  const [selectedTraitIds, setSelectedTraitIds] = useState<number[]>([]);
  const [previewResponses, setPreviewResponses] = useState<PreviewChatAnswer[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [sampleDataError, setSampleDataError] = useState<string | null>(null);
  const [isSampleLoading, setIsSampleLoading] = useState(false);
  const [sampleLoadProgress, setSampleLoadProgress] = useState<SampleLoadProgress>(INITIAL_SAMPLE_LOAD_PROGRESS);
  const [detailResult, setDetailResult] = useState<SavedResult | null>(null);
  const [expandedTraitId, setExpandedTraitId] = useState<number | null>(null);
  const [commentaryResult, setCommentaryResult] = useState<SavedResult | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [runAllProgress, setRunAllProgress] = useState<OnboardingRunAllProgress>({
    phase: "downloading",
    loaded: 0,
    total: 100,
    elapsedSeconds: 0,
    processedStudies: 0,
    matchCount: 0,
    message: "Downloading the lightweight study catalog for your preview.",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const analysisStartedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      setHasConsent(localStorage.getItem(CONSENT_STORAGE_KEY) === "true");
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    analysisStartedRef.current = false;
    setCurrentStep(mode === "instant_preview" ? "run_all" : "intro");
    setCompletionPath("own_dna");
    setTraitCandidates([]);
    setSelectedTraitIds([]);
    setPreviewResponses([]);
    setAnalysisError(null);
    setResponseError(null);
    setResponsesLoading(false);
    setSampleDataError(null);
    setIsSampleLoading(false);
    setSampleLoadProgress(INITIAL_SAMPLE_LOAD_PROGRESS);
    setDetailResult(null);
    setExpandedTraitId(null);
    setCommentaryResult(null);
    setPendingQuestion(null);
    setActiveQuestion(null);
    setShowConsentModal(false);
    setRunAllProgress({
      phase: "downloading",
      loaded: 0,
      total: 100,
      elapsedSeconds: 0,
      processedStudies: 0,
      matchCount: 0,
      message: "Downloading the lightweight study catalog for your preview.",
    });
    trackOnboardingStarted(mode);
  }, [isOpen, mode]);

  useEffect(() => {
    if (isOpen && mounted) {
      trackOnboardingStepViewed(currentStep, {
        stepNumber: HAPPY_PATH_STEP_INDEX[currentStep] || 1,
        totalSteps: 6,
        mode,
        userPath: completionPath,
      });
    }
  }, [completionPath, currentStep, isOpen, mode, mounted]);

  useEffect(() => {
    if (typeof window === "undefined" || commentaryResult) return;
    setHasConsent(localStorage.getItem(CONSENT_STORAGE_KEY) === "true");
  }, [commentaryResult]);

  const selectedTraitResults = useMemo(
    () => traitCandidates.filter((result) => selectedTraitIds.includes(result.studyId)),
    [selectedTraitIds, traitCandidates]
  );
  const sampleDownloadFraction = sampleLoadProgress.totalBytes > 0
    ? Math.max(0, Math.min(sampleLoadProgress.downloadedBytes / sampleLoadProgress.totalBytes, 1))
    : sampleLoadProgress.phase === "downloading"
      ? 0
      : sampleLoadProgress.phase === "idle"
        ? 0
        : 1;
  const sampleIngestFraction = sampleLoadProgress.phase === "complete"
    ? 1
    : sampleLoadProgress.phase === "ingesting"
      ? 0.7
      : 0;
  const sampleReadyFraction = sampleLoadProgress.phase === "complete" ? 1 : 0;

  const completeFlow = useCallback(() => {
    localStorage.setItem("conversion_onboarding_completed", "true");
    localStorage.setItem("user_path", completionPath);
    trackOnboardingCompleted(completionPath);
    onComplete();
  }, [completionPath, onComplete]);

  const generateSecureResponses = useCallback(async (question: string) => {
    setResponsesLoading(true);
    setResponseError(null);
    setActiveQuestion(question);

    try {
      const relevantResults = await getTopResultsByRelevance(question, 500);
      const llmDescription = getLLMDescription();
      const contextResults = relevantResults
        .map(
          (result, index) => `${index + 1}. ${result.traitName} (${result.studyTitle}):
   - Your genotype: ${result.userGenotype}
   - Risk allele: ${result.riskAllele}
   - Risk score: ${formatRiskScore(result.riskScore, result.riskLevel, result.effectType)} (${result.riskLevel})
   - SNP: ${result.matchedSnp}`
        )
        .join("\n\n");

      const systemPrompt = `You are an expert providing personalized, holistic insights about GWAS results. ${llmDescription}

IMPORTANT CONTEXT:
- The user has uploaded their DNA file and analyzed it against thousands of GWAS studies
- They have ${savedResults.length.toLocaleString()} total results in memory
- You will be provided with the top ${relevantResults.length} most relevant results for this question based on semantic similarity

YOUR MOST RELEVANT RESULTS FOR THIS QUERY:
${contextResults}

USER'S SPECIFIC QUESTION:
"${question}"

⚠️ CRITICAL - STAY ON TOPIC:
- Refuse to answer questions not related to the user's genetic data.
- Answer ONLY the specific trait or theme asked about in the question.
- Do NOT discuss unrelated traits from the context unless directly relevant.
- Any health recommendations are based on LLM training data and may be subject to hallucinations and errors, so the user should consult a physician if they have real health concerns.

RESPONSE STRUCTURE:
- Use short headers (##) when useful.
- Keep the answer focused, specific, and readable.
- Explain findings in plain language.
- Include a short practical takeaway section.
- Do NOT use markdown tables.
- Prefer short paragraphs and flat bullet lists.
- Keep the total answer compact enough to fit comfortably in an in-app preview.
- This is educational, not medical advice.`;

      const response = await callLLM(
        [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: question,
          },
        ],
        {
          maxTokens: 2200,
          temperature: 0.7,
          reasoningEffort: "medium",
        }
      );

      const answer = response.content.trim();
      if (!answer) {
        throw new Error("The DNA Chat preview returned an empty response.");
      }

      setPreviewResponses((prev) => {
        const withoutCurrent = prev.filter((item) => item.question !== question);
        return [...withoutCurrent, { question, answer, studiesUsed: relevantResults.length }];
      });
      setActiveQuestion(question);
      trackLLMQuestionAsked();
    } catch (generationError) {
      console.error("[ConversionOnboarding] Secure responses failed:", generationError);
      setResponseError(
        generationError instanceof Error
          ? generationError.message
          : "The DNA Chat preview could not be generated right now."
      );
    } finally {
      setResponsesLoading(false);
    }
  }, [getTopResultsByRelevance, savedResults.length]);

  const loadSampleData = useCallback(async () => {
    if (isSampleLoading) return;

    setSampleDataError(null);
    setIsSampleLoading(true);
    trackSampleDataStarted("onboarding");
    setSampleLoadProgress({
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: 0,
    });

    try {
      const response = await fetch(SAMPLE_DATA_URL, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Sample data download failed with status ${response.status}.`);
      }

      const totalBytes = Number(response.headers.get("content-length") || "0");
      let blob: Blob;

      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let downloadedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          chunks.push(value);
          downloadedBytes += value.byteLength;
          setSampleLoadProgress({
            phase: "downloading",
            downloadedBytes,
            totalBytes,
          });
        }

        blob = new Blob(chunks as unknown as BlobPart[], { type: "text/plain" });
      } else {
        blob = await response.blob();
      }

      const resolvedTotalBytes = totalBytes || blob.size;
      setSampleLoadProgress({
        phase: "ingesting",
        downloadedBytes: resolvedTotalBytes,
        totalBytes: resolvedTotalBytes,
      });

      const sampleFile = new File([blob], "monadicdna-sample-data.txt", { type: "text/plain" });
      const uploaded = await uploadGenotype(sampleFile);

      if (!uploaded) {
        throw new Error("The sample data could not be loaded into the app.");
      }

      trackSampleDataLoaded("onboarding", sampleFile.size);
      setSampleLoadProgress({
        phase: "complete",
        downloadedBytes: resolvedTotalBytes,
        totalBytes: resolvedTotalBytes,
      });

      await new Promise((resolve) => window.setTimeout(resolve, 250));
      setCurrentStep("run_all");
    } catch (sampleError) {
      console.error("[ConversionOnboarding] Sample data load failed:", sampleError);
      trackSampleDataFailed(
        "onboarding",
        sampleError instanceof Error ? sampleError.message : "sample_data_failed"
      );
      setSampleDataError(
        sampleError instanceof Error
          ? sampleError.message
          : "The sample data could not be loaded right now."
      );
    } finally {
      setIsSampleLoading(false);
    }
  }, [isSampleLoading, uploadGenotype]);

  const startRunAll = useCallback(async () => {
    if (!genotypeData) return;

    try {
      setAnalysisError(null);
      trackRunAllStarted(0);

      const results = await runAllAnalysisOnboarding(
        genotypeData,
        (progress) => setRunAllProgress(progress),
        (studyId) => savedResults.some((result) => result.studyId === studyId)
      );

      await addResultsBatch(results);

      const mergedResults = dedupeStudyResults([...savedResults, ...results]);
      const candidates = buildTraitCandidates(mergedResults);

      if (!candidates.length) {
        throw new Error("The preview run completed, but there were not enough matched traits to build the next screen.");
      }

      setTraitCandidates(candidates);
      setSelectedTraitIds(candidates.slice(0, Math.min(REQUIRED_TRAIT_COUNT, candidates.length)).map((result) => result.studyId));
      setRunAllProgress((prev) => ({
        ...prev,
        phase: "complete",
        loaded: prev.processedStudies || prev.loaded,
        total: prev.processedStudies || prev.total,
        message: "Preview analysis complete.",
      }));
      trackRunAllCompleted(0, results.length, candidates.length, "onboarding");
    } catch (runError) {
      console.error("[ConversionOnboarding] Onboarding preview failed:", runError);
      const message = runError instanceof Error ? runError.message : "The onboarding preview did not complete cleanly.";
      trackRunAllFailed("onboarding", message);
      setAnalysisError(message);
      setRunAllProgress((prev) => ({
        ...prev,
        phase: "error",
        message,
      }));
    }
  }, [addResultsBatch, genotypeData, savedResults]);

  useEffect(() => {
    if (!isOpen || currentStep !== "run_all" || !genotypeData || genotypeData.size === 0 || analysisStartedRef.current) {
      return;
    }

    analysisStartedRef.current = true;
    void startRunAll();
  }, [currentStep, genotypeData, isOpen, startRunAll]);

  useEffect(() => {
    frameRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep]);

  const goToResponses = useCallback(() => {
    setPreviewResponses([]);
    setResponseError(null);
    setResponsesLoading(false);
    setDetailResult(null);
    setPendingQuestion(null);
    setActiveQuestion(null);

    setCurrentStep("responses");
  }, []);

  const slideNumber = HAPPY_PATH_STEP_INDEX[currentStep] || 1;
  const progressFraction = getProgressFraction(runAllProgress);
  const backStep = getBackStep(currentStep, completionPath);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      {commentaryResult && (
        <LLMCommentaryModal
          isOpen={!!commentaryResult}
          onClose={() => setCommentaryResult(null)}
          currentResult={commentaryResult}
          allResults={savedResults}
          skipPersonalizationPrompt
        />
      )}

      <NilAIConsentModal
        isOpen={showConsentModal}
        onAccept={() => {
          localStorage.setItem(CONSENT_STORAGE_KEY, "true");
          setHasConsent(true);
          setShowConsentModal(false);
          trackAIConsentGiven();
          if (pendingQuestion) {
            const nextQuestion = pendingQuestion;
            setPendingQuestion(null);
            void generateSecureResponses(nextQuestion);
            return;
          }
        }}
        onDecline={() => {
          setPendingQuestion(null);
          setShowConsentModal(false);
          trackAIConsentDeclined();
        }}
      />

      <div className="wire-onboarding-overlay">
        <div className="wire-onboarding-shell">
          <div className="wire-onboarding-frame" ref={frameRef}>
            {onDismiss && (
              <button
                className="wire-onboarding-close"
                onClick={() => { trackOnboardingDismissed(currentStep); onDismiss(); }}
                aria-label="Close onboarding"
              >
                ✕
              </button>
            )}
            <div className="wire-onboarding-step">Step {slideNumber} of 6</div>

            {currentStep === "intro" && (
              <section className="wire-onboarding-slide">
                <h1>Monadic DNA Explorer uses 1m+ scientifically vetted genetic traits to help you understand your health, diet and exercise.</h1>
                <p>We do not store or look at your DNA or sell it to third parties.</p>
                <button
                  className="wire-onboarding-primary"
                  onClick={() => {
                    trackOnboardingAction("intro_continue");
                    setCurrentStep("path");
                  }}
                >
                  Let&apos;s Go
                </button>
                <button
                  className="wire-onboarding-text-link"
                  onClick={() => {
                    trackOnboardingAction("intro_skip_never_show");
                    localStorage.setItem("conversion_onboarding_completed", "true");
                    onDismiss?.();
                  }}
                >
                  Skip this tour and do not show it again
                </button>
                <button
                  className="wire-onboarding-text-link"
                  onClick={() => {
                    trackOnboardingAction("intro_researcher_path");
                    localStorage.setItem("conversion_onboarding_completed", "true");
                    localStorage.setItem("user_path", "researcher");
                    onComplete();
                  }}
                >
                  I am just a researcher who wants to explore the GWAS Catalog
                </button>
              </section>
            )}

            {currentStep === "path" && (
              <section className="wire-onboarding-slide">
                <h1>Let&apos;s get you ready to use Explorer. Pick the option which best applies to you:</h1>
                <div className="wire-onboarding-choice-list">
                  <button
                    className="wire-onboarding-choice primary"
                    onClick={() => {
                      setCompletionPath("own_dna");
                      trackOnboardingPathChosen("own_dna");
                      setCurrentStep("upload");
                    }}
                  >
                    I have done a test with 23andMe, AncestryDNA or similar and I have my data &gt;&gt;
                  </button>
                  <button
                    className="wire-onboarding-choice"
                    onClick={() => {
                      setCompletionPath("own_dna_needs_help");
                      trackOnboardingPathChosen("own_dna_needs_help");
                      setCurrentStep("need_file");
                    }}
                  >
                    I have done a DNA test but I need help getting my data &gt;&gt;
                  </button>
                  <button
                    className="wire-onboarding-choice"
                    onClick={() => {
                      setCompletionPath("own_dna_no_test");
                      trackOnboardingPathChosen("own_dna_no_test");
                      setCurrentStep("need_sequencing");
                    }}
                  >
                    I would like to get my DNA sequenced privately and anonymously &gt;&gt;
                  </button>
                </div>
              </section>
            )}

            {currentStep === "need_file" && (
              <section className="wire-onboarding-slide">
                <h1>Click on your DNA testing provider for instructions on how to download a copy of your DNA data</h1>
                <div className="wire-onboarding-actions">
                  <button
                    className="wire-onboarding-secondary"
                    onClick={() => {
                      trackOnboardingAction("provider_instructions_clicked", { provider: "23andme" });
                      window.open(GUIDE_23ANDME_URL, "_blank", "noopener,noreferrer");
                    }}
                  >
                    [23andMe]
                  </button>
                  <button
                    className="wire-onboarding-secondary"
                    onClick={() => {
                      trackOnboardingAction("provider_instructions_clicked", { provider: "ancestry" });
                      window.open(GUIDE_ANCESTRY_URL, "_blank", "noopener,noreferrer");
                    }}
                  >
                    [Ancestry DNA]
                  </button>
                </div>
                <p>While you&apos;re waiting for your data, let&apos;s give you a taste of what you will be able to do with your data.</p>
                <div className="wire-onboarding-actions">
                  <button
                    className="wire-onboarding-primary"
                    onClick={() => {
                      trackOnboardingAction("sample_preview_selected", { from_step: "need_file" });
                      setCurrentStep("sample_data");
                    }}
                  >
                    Show Me
                  </button>
                </div>
              </section>
            )}

            {currentStep === "need_sequencing" && (
              <section className="wire-onboarding-slide">
                <h1>We are working on an app called Batcher for letting you privately and anonymously get your DNA sequenced.</h1>
                <p>Use the link below to sign up and get notified as soon as the service is ready.</p>
                <div className="wire-onboarding-actions">
                  <button
                    className="wire-onboarding-secondary"
                    onClick={() => {
                      trackOnboardingAction("sequencing_signup_clicked");
                      window.open(SEQUENCING_URL, "_blank", "noopener,noreferrer");
                    }}
                  >
                    Testing Sign Up Form
                  </button>
                </div>
                <p>While you&apos;re waiting to get sequenced, let&apos;s give you a taste of what you will be able to do with your data.</p>
                <div className="wire-onboarding-actions">
                  <button
                    className="wire-onboarding-primary"
                    onClick={() => {
                      trackOnboardingAction("sample_preview_selected", { from_step: "need_sequencing" });
                      setCurrentStep("sample_data");
                    }}
                  >
                    Show Me
                  </button>
                </div>
              </section>
            )}

            {currentStep === "sample_data" && (
              <section className="wire-onboarding-slide">
                <h1>Downloading and uploading some sample data to help you explore this product!</h1>
                <p>
                  Your data never leaves your device. Explorer stores it in the IndexedDB of your browser.
                </p>
                <p>We not do not transmit your data to our servers or snoop on it in any way.</p>
                {(isSampleLoading || sampleLoadProgress.phase === "complete") && (
                  <div className="wire-sample-progress-panel">
                    <div className="wire-sample-progress-row">
                      <div className="wire-sample-progress-copy">
                        <strong>Downloading sample dataset</strong>
                        <span>
                          {sampleLoadProgress.phase === "downloading"
                            ? sampleLoadProgress.totalBytes > 0
                              ? `${Math.round(sampleDownloadFraction * 100)}% downloaded (${formatSampleBytes(sampleLoadProgress.downloadedBytes)} / ${formatSampleBytes(sampleLoadProgress.totalBytes)})`
                              : `${formatSampleBytes(sampleLoadProgress.downloadedBytes)} downloaded`
                            : "Download complete"}
                        </span>
                      </div>
                      <div className="wire-progress-bar">
                        <span style={{ width: `${sampleDownloadFraction * 100}%` }} />
                      </div>
                    </div>

                    <div className="wire-sample-progress-row">
                      <div className="wire-sample-progress-copy">
                        <strong>Loading sample data into your browser</strong>
                        <span>
                          {sampleLoadProgress.phase === "complete"
                            ? "Sample data loaded into the app"
                            : sampleLoadProgress.phase === "ingesting"
                              ? "Parsing and preparing the sample file locally"
                              : "Waiting for download to finish"}
                        </span>
                      </div>
                      <div className={`wire-progress-bar${sampleLoadProgress.phase === "ingesting" ? " indeterminate" : ""}`}>
                        <span style={{ width: `${sampleIngestFraction * 100}%` }} />
                      </div>
                    </div>

                    <div className="wire-sample-progress-row">
                      <div className="wire-sample-progress-copy">
                        <strong>Ready to analyze</strong>
                        <span>
                          {sampleLoadProgress.phase === "complete"
                            ? "Sample data is ready. Starting the preview analysis now"
                            : "This will unlock the onboarding preview as soon as loading finishes"}
                        </span>
                      </div>
                      <div className="wire-progress-bar">
                        <span style={{ width: `${sampleReadyFraction * 100}%` }} />
                      </div>
                    </div>
                  </div>
                )}
                <div className="wire-onboarding-actions">
                  <button className="wire-onboarding-primary" onClick={() => void loadSampleData()} disabled={isSampleLoading || isLoading}>
                    {isSampleLoading || isLoading ? "Loading sample data..." : "Analyze Sample Data >>"}
                  </button>
                </div>
                {(sampleDataError || error) && (
                  <div className="wire-inline-message error">
                    <strong>Sample data issue</strong>
                    <span>{sampleDataError || error}</span>
                  </div>
                )}
              </section>
            )}

            {currentStep === "upload" && (
              <section className="wire-onboarding-slide">
                <h1>Upload your DNA data to get started!</h1>
                <p>Your data never leaves your device. Explorer stores it in the IndexedDB of your browser.</p>
                <p>We not do not transmit your data to our servers or snoop on it in any way.</p>

                <div className="wire-upload-box">
                  <button
                    className="wire-onboarding-primary"
                    onClick={() => {
                      if (isUploaded && genotypeData && genotypeData.size > 0) {
                        trackOnboardingAction("own_data_analysis_started");
                        setCurrentStep("run_all");
                        return;
                      }
                      trackOnboardingAction("upload_picker_opened");
                      fileInputRef.current?.click();
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? "Loading your DNA file..." : isUploaded ? "Analyze My Data >>" : "Upload"}
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.tsv,.csv"
                    hidden
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const uploaded = await uploadGenotype(file, "onboarding_upload");
                      if (uploaded) {
                        trackOnboardingAction("own_data_uploaded");
                      }
                      event.target.value = "";
                    }}
                  />

                  {originalFileName && <p className="wire-upload-note">{originalFileName}</p>}
                  {error && <p className="wire-upload-error">{error}</p>}
                </div>

                {isUploaded && genotypeData && genotypeData.size > 0 && (
                  <p>Your data has been uploaded and is now ready for analysis!</p>
                )}
              </section>
            )}

            {currentStep === "run_all" && (
              <section className="wire-onboarding-slide">
                <h1>Let&apos;s analyze your data fully locally in your browser.</h1>
                {runAllProgress.phase === "downloading" && <p>Downloading one million scientifically vetted traits from the GWAS Catalog..</p>}
                {runAllProgress.phase === "decompressing" && <p>Preparing the GWAS Catalog data in your browser..</p>}
                {(runAllProgress.phase === "analyzing" || runAllProgress.phase === "complete") && (
                  <p>Running your data against the GWAS Catalog to find all matches..</p>
                )}

                <div className="wire-progress-panel">
                  <div className={`wire-progress-spinner ${runAllProgress.phase === "complete" ? "complete" : ""}`} />
                  <h2>{getProgressTitle(runAllProgress)}</h2>

                  <div className="wire-progress-bar">
                    <span style={{ width: `${progressFraction * 100}%` }} />
                  </div>

                  <div className="wire-progress-stats">
                    {runAllProgress.phase === "downloading" && (
                      <>
                        <div>{Math.round(progressFraction * 100)}% Downloaded</div>
                      </>
                    )}

                    {runAllProgress.phase === "decompressing" && (
                      <>
                        <div>{Math.round(progressFraction * 100)}% Loaded..</div>
                      </>
                    )}

                    {runAllProgress.phase === "analyzing" && (
                      <>
                        <div>{Math.round(progressFraction * 100)}% Processed</div>
                        <div>{runAllProgress.processedStudies.toLocaleString()} studies scanned</div>
                      </>
                    )}

                    {runAllProgress.phase === "complete" && (
                      <>
                        <div>We found {runAllProgress.matchCount.toLocaleString()} matched traits. Let&apos;s look at some traits!</div>
                      </>
                    )}

                    {runAllProgress.phase === "error" && <div>{analysisError || runAllProgress.message}</div>}
                  </div>
                </div>

                {runAllProgress.phase === "complete" && traitCandidates.length > 0 && (
                  <button
                    className="wire-onboarding-primary"
                    onClick={() => {
                      trackOnboardingAction("traits_preview_opened", { result_count: traitCandidates.length });
                      setCurrentStep("traits");
                    }}
                  >
                    Show Me Some Traits &gt;&gt;
                  </button>
                )}

                {analysisError && (
                  <div className="wire-inline-message error">
                    <strong>Preview issue</strong>
                    <span>{analysisError}</span>
                  </div>
                )}
              </section>
            )}

            {currentStep === "traits" && (
              <section className="wire-onboarding-slide">
                <h1>Here are {selectedTraitResults.length} curated traits from your data.</h1>
                <p>Using the Explore tab in at app, you can filter through and explore all {savedResults.length.toLocaleString()} of your results!</p>

                <div className="wire-trait-table">
                  {selectedTraitResults.map((result) => {
                    const isOpen = expandedTraitId === result.studyId;
                    const isExpanded = detailResult?.studyId === result.studyId;
                    return (
                      <article
                        key={result.studyId}
                        className={`wire-trait-row tone-${getRiskTone(result)}${isOpen ? " open" : ""}`}
                      >
                        <button
                          className={`wire-trait-row-toggle${isOpen ? " open" : ""}`}
                          onClick={() => {
                            if (isOpen) {
                              setExpandedTraitId(null);
                              if (isExpanded) setDetailResult(null);
                              return;
                            }

                            setExpandedTraitId(result.studyId);
                          }}
                          type="button"
                        >
                          <span className="wire-trait-row-toggle-copy">
                            <strong>{result.traitName}</strong>
                            <span>{isOpen ? "Hide details" : "Show details"}</span>
                          </span>
                          <span className="wire-trait-row-toggle-icon" aria-hidden="true">
                            {isOpen ? "−" : "+"}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="wire-trait-row-body">
                            <div className="wire-trait-row-top">
                              <div className="wire-trait-row-copy">
                                <span className="wire-trait-row-study"><span className="wire-trait-label">Study Title: </span>{result.studyTitle}</span>
                                {result.mappedGene && <span className="wire-trait-row-meta"><span className="wire-trait-label">Gene: </span>{result.mappedGene}</span>}
                                <span className="wire-trait-row-meta"><span className="wire-trait-label">SNP: </span>{result.matchedSnp}</span>
                              </div>
                              <div className="wire-trait-row-actions">
                                <button
                                  className="wire-onboarding-secondary"
                                  onClick={() => setDetailResult(isExpanded ? null : result)}
                                  type="button"
                                >
                                  View Result
                                </button>
                                <button
                                  className="wire-onboarding-primary"
                                  onClick={() => {
                                    setDetailResult(null);
                                    setCommentaryResult(result);
                                  }}
                                  type="button"
                                >
                                  Interpret with AI
                                </button>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="wire-result-summary">
                                <div className="wire-result-callout">
                                  <strong>Your genotype</strong>
                                  <span className="wire-result-genotype">{result.userGenotype}</span>
                                </div>
                                <div className="wire-result-callout">
                                  <strong>Your result</strong>
                                  <span>{formatRiskHeadline(result)}</span>
                                  <em>{formatRiskScore(result.riskScore, result.riskLevel, result.effectType)} for your genotype</em>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <div className="wire-next-step-panel">
                  <span className="wire-next-step-kicker">Next Step</span>
                  <strong>Now ask questions about your whole dataset with secure AI.</strong>
                  <p>Use premium LLM analysis to answer broader questions using the most relevant traits from your uploaded DNA data.</p>
                  <button
                    className="wire-onboarding-primary"
                    onClick={() => {
                      trackOnboardingAction("chat_preview_opened");
                      goToResponses();
                    }}
                    disabled={!selectedTraitResults.length}
                  >
                    Run Some LLM Analysis &gt;&gt;
                  </button>
                </div>
              </section>
            )}

            {currentStep === "responses" && (
              <section className="wire-onboarding-slide">
                <h1>Here is an advance look at DNA Chat.</h1>
                <p>Tap one of these starter questions to see how DNA Chat answers with the most relevant traits from your full dataset.</p>

                <div className="wire-question-list">
                  {CHAT_PREVIEW_QUESTIONS.map((question) => {
                    const response = previewResponses.find((item) => item.question === question);
                    const isOpen = activeQuestion === question;
                    const isLoadingCurrent = responsesLoading && activeQuestion === question;

                    return (
                      <article key={question} className={`wire-question-item${isOpen ? " open" : ""}`}>
                        <button
                          className={`wire-question-card${isOpen ? " active" : ""}`}
                          onClick={() => {
                            if (isOpen && !isLoadingCurrent) {
                              setActiveQuestion(null);
                              return;
                            }

                            setActiveQuestion(question);
                            trackOnboardingAction("chat_preview_question_selected");

                            if (response) {
                              return;
                            }

                            if (!hasConsent) {
                              setPendingQuestion(question);
                              setShowConsentModal(true);
                              return;
                            }

                            void generateSecureResponses(question);
                          }}
                          disabled={responsesLoading && activeQuestion !== question}
                          type="button"
                        >
                          <span>{question}</span>
                          <span className="wire-question-toggle">
                            {isLoadingCurrent ? "Thinking..." : isOpen ? "Hide" : "Show"}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="wire-question-panel">
                            {isLoadingCurrent && (
                              <div className="wire-chat-preview-card loading">
                                <div className="wire-chat-loading-header">
                                  <strong>Running DNA Chat preview</strong>
                                  <span>Searching your matched results for this question</span>
                                </div>
                                <div className="wire-chat-loading-lines" aria-hidden="true">
                                  <span />
                                  <span />
                                  <span />
                                </div>
                              </div>
                            )}

                            {!isLoadingCurrent && responseError && !response && (
                              <div className="wire-inline-message error">
                                <strong>Secure preview issue</strong>
                                <span>{responseError}</span>
                              </div>
                            )}

                            {!isLoadingCurrent && response && (
                              <div className="wire-chat-preview-card">
                                <div className="wire-chat-answer">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {response.answer}
                                  </ReactMarkdown>
                                </div>
                                <div className="wire-chat-meta">Used {response.studiesUsed.toLocaleString()} relevant genetic results</div>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                {!responsesLoading && !responseError && previewResponses.length > 0 && (
                  <>
                    <p>Use promo code <strong>FREEWEEK</strong> for a free week of premium features.</p>
                    <p>Personalize your answers by entering your demographics, history, reports documents in the app.</p>
                    <p>Nobody apart from you can ever look at your chat logs or personalization information.</p>
                    <p><strong>You&apos;re now ready to start using the app to unlock your diet, lifestyle and health insights!</strong></p>
                  </>
                )}

                <button
                  className="wire-onboarding-primary"
                  onClick={completeFlow}
                  disabled={responsesLoading || (!!selectedTraitResults.length && !previewResponses.length && !responseError)}
                >
                  Let&apos;s Go!
                </button>
              </section>
            )}

            <div className="wire-onboarding-footer">
              {backStep ? (
                <button className="wire-onboarding-back" onClick={() => setCurrentStep(backStep)}>
                  Back
                </button>
              ) : (
                <span />
              )}
              <span>{slideNumber} / 6</span>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
