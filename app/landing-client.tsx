"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGenotype } from "./components/UserDataUpload";
import { useResults } from "./components/ResultsContext";
import { useCustomization, type UserCustomization } from "./components/CustomizationContext";
import { ResultsManager } from "@/lib/results-manager";
import { runAllAnalysisOnboarding, type OnboardingRunAllProgress } from "@/lib/run-all-onboarding";
import { selectAhaPreviewResults } from "@/lib/preview-insights";
import {
  trackFirstResultViewed,
  trackGetStartedClicked,
  trackProviderGuideClicked,
  trackQuickPreviewCompleted,
  trackQuickPreviewFailed,
  trackQuickPreviewStarted,
  trackSampleDataStarted,
  trackSampleDataLoaded,
  trackSampleDataFailed,
} from "@/lib/analytics";

const SAMPLE_RESULTS_FILE_NAME = "monadic_dna_explorer_results_2026-05-19.tsv";
const SAMPLE_CUSTOMIZATION_PASSWORD = "sample-data";

const SAMPLE_CUSTOMIZATION: UserCustomization = {
  ethnicities: ["European"],
  countriesOfOrigin: [],
  genderAtBirth: "male",
  age: 44,
  personalConditions: ["Type 2 diabetes", "Hypertension"],
  familyConditions: ["Coronary artery disease", "Alzheimer's disease"],
  smokingHistory: "past-smoker",
  alcoholUse: "mild",
  medications: [],
  diet: "mediterranean",
};

type SampleLoadStatus = "idle" | "downloading" | "loading" | "loaded" | "error";
type PreviewStatus = "idle" | "running" | "complete" | "error";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SCHEDULE_CALL_URL = "https://calendar.app.google/eVDN4d44GreUjR8p8";

const PRIVACY_POLICY_URL = "https://monadicdna.com/privacy";

const featureCopy = [
  {
    label: "Explore",
    href: "/explore",
    text: "Get an overview of what your results actually mean. See your strongest genetic signals, both elevated risks and protective findings, and find which ones connect to conditions in your personal or family health history.",
  },
  {
    label: "DNA Chat",
    href: "/dna-chat",
    text: "Ask questions about your genetic data in plain English. Get clear explanations of specific findings, genes, and what the research says. It works like a conversation with a knowledgeable friend.",
  },
  {
    label: "Browse",
    href: "/browse",
    text: "Search and filter thousands of genetic research studies. See which ones matched your DNA, how strong the effect is, and read the published science behind each result.",
  },
  {
    label: "Analyze",
    href: "/overview-report",
    text: "Generate AI-written reports from your full set of results. Reports find patterns, connect findings to your health history, and build a picture of your genetic biology. The Health Insights report is free. Additional reports require a subscription.",
  },
  {
    label: "Privacy first",
    href: PRIVACY_POLICY_URL,
    text: "Your DNA never leaves your device. We don't store, share, or sell your genetic data. All AI analysis runs in a private computing environment so your data stays yours.",
    external: true,
  },
];

export default function LandingClient() {
  const router = useRouter();
  const { error, isUploaded, genotypeData, originalFileName, originalFileSize, detectedFormat } = useGenotype();
  const { addResultsBatch, clearResults, savedResults, hasResult } = useResults();
  const { saveCustomization, status: customizationStatus } = useCustomization();
  const [sampleStatus, setSampleStatus] = useState<SampleLoadStatus>("idle");
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleBytes, setSampleBytes] = useState(0);
  const [sampleTotalBytes, setSampleTotalBytes] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<OnboardingRunAllProgress | null>(null);
  const [previewTraitNames, setPreviewTraitNames] = useState<string[]>([]);

  const openDNAUpload = () => {
    trackGetStartedClicked("home_upload_raw_dna");
    window.dispatchEvent(new CustomEvent("openDNAUpload", { detail: { source: "home_upload_raw_dna" } }));
  };

  const startFullAnalysis = () => {
    trackGetStartedClicked("home_analyze_uploaded_dna");
    window.dispatchEvent(new CustomEvent("startRunAllAnalysis"));
  };

  const runQuickPreview = async () => {
    if (!genotypeData || previewStatus === "running") return;

    trackQuickPreviewStarted("home");
    setPreviewStatus("running");
    setPreviewError(null);
    setPreviewTraitNames([]);

    try {
      const results = await runAllAnalysisOnboarding(
        genotypeData,
        (progress) => setPreviewProgress(progress),
        hasResult,
        { maxResults: 1000 }
      );

      if (!results.length) {
        throw new Error("No preview matches were found in the quick scan. You can still run the full catalog analysis.");
      }

      const curatedResults = selectAhaPreviewResults(results, 12);
      await addResultsBatch(curatedResults);
      const traitNames = curatedResults.slice(0, 3).map((result) => result.traitName);
      setPreviewTraitNames(traitNames);
      setPreviewStatus("complete");
      trackQuickPreviewCompleted(curatedResults.length, "home");
      trackFirstResultViewed("home_preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "The quick preview could not complete.";
      setPreviewStatus("error");
      setPreviewError(message);
      trackQuickPreviewFailed(message, "home");
    }
  };

  const loadSampleData = async () => {
    if (savedResults.length > 0) {
      router.push("/explore");
      return;
    }

    trackSampleDataStarted('home');

    try {
      setSampleStatus("downloading");
      setSampleError(null);
      setSampleBytes(0);
      setSampleTotalBytes(0);

      const response = await fetch("/api/sample-results", { method: "GET" });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);

      const total = Number(response.headers.get("content-length") || "0");
      setSampleTotalBytes(total);

      const decoder = new TextDecoder();
      let content = "";
      let downloaded = 0;

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            downloaded += value.byteLength;
            content += decoder.decode(value, { stream: true });
            setSampleBytes(downloaded);
          }
        }
        content += decoder.decode();
      } else {
        content = await response.text();
        downloaded = new Blob([content]).size;
        setSampleBytes(downloaded);
      }

      setSampleStatus("loading");

      const session = ResultsManager.parseResultsFile(content, SAMPLE_RESULTS_FILE_NAME);
      if (!session.results.length) throw new Error("Sample file contained no usable results.");

      await clearResults();
      await addResultsBatch(session.results);

      if (customizationStatus === "not-set") {
        await saveCustomization(SAMPLE_CUSTOMIZATION, SAMPLE_CUSTOMIZATION_PASSWORD);
      }

      trackSampleDataLoaded('home', downloaded, session.results.length);
      setSampleStatus("loaded");
      router.push("/explore");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not load sample data.";
      trackSampleDataFailed('home', msg);
      setSampleStatus("error");
      setSampleError(msg);
    }
  };

  const sampleLabel =
    sampleStatus === "downloading" ? "Downloading…" :
    sampleStatus === "loading" ? "Parsing…" :
    sampleStatus === "loaded" ? "Loaded" :
    "Try with sample data";

  const sampleProgressText =
    sampleStatus === "downloading" && sampleBytes > 0
      ? sampleTotalBytes > 0
        ? `${formatBytes(sampleBytes)} / ${formatBytes(sampleTotalBytes)}`
        : `${formatBytes(sampleBytes)} downloaded`
      : sampleStatus === "loading"
      ? "Parsing results…"
      : null;

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const previewProgressText =
    previewStatus === "running" && previewProgress
      ? previewProgress.phase === "downloading"
        ? "Preparing preview catalog..."
        : previewProgress.phase === "analyzing"
        ? `Scanning studies, ${previewProgress.matchCount} candidate matches found`
        : previewProgress.message
      : null;

  return (
    <main className="page landing-page landing-home-page">
      <section className="landing-home-intro">
        <div className="landing-home-copy">
          <h1>Analyze your raw DNA file privately.</h1>

          <p className="landing-home-subtitle">
            Upload a 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, CSV, or TSV file. Your raw DNA file stays in your browser while the app matches variants against GWAS Catalog research.
          </p>

          {error && <p className="landing-upload-error">{error}</p>}

          <div className="landing-home-proof" aria-label="Privacy and scientific safeguards">
            <span>Local file processing</span>
            <span>No DNA account required</span>
            <span>GWAS evidence, effect sizes, and p-values</span>
            <span>Educational use, not diagnosis</span>
          </div>

          <div className="landing-home-explainer" aria-label="Monadic DNA Explorer features">
            {featureCopy.map((item) => (
              <p key={item.label}>
                <span>
                  {item.href ? (
                    item.external ? (
                      <a href={item.href} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                        {item.label}
                      </a>
                    ) : (
                      <Link href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {item.label}
                      </Link>
                    )
                  ) : (
                    item.label
                  )}
                </span>
                {item.text}
              </p>
            ))}
          </div>
        </div>

        <div className="landing-home-start-panel" aria-label="Start private DNA analysis">
          <h2>Start with your raw DNA file</h2>

          <div className="landing-start-actions">
            {isUploaded ? (
              <button
                className="landing-primary-button"
                onClick={savedResults.length > 0 || previewStatus === "complete" ? () => router.push("/explore") : runQuickPreview}
                disabled={previewStatus === "running"}
              >
                {previewStatus === "running"
                  ? "Finding preview results..."
                  : savedResults.length > 0 || previewStatus === "complete"
                  ? "Explore my results"
                  : "Run quick preview"}
              </button>
            ) : (
              <button
                className="landing-primary-button"
                onClick={openDNAUpload}
              >
                Upload raw DNA file
              </button>
            )}

            <button
              className="landing-secondary-button"
              onClick={isUploaded ? startFullAnalysis : loadSampleData}
              disabled={previewStatus === "running" || sampleStatus === "downloading" || sampleStatus === "loading"}
            >
              {isUploaded ? "Run full analysis" : sampleLabel}
            </button>

            {isUploaded && savedResults.length === 0 && (
              <button
                className="landing-secondary-button"
                onClick={loadSampleData}
                disabled={previewStatus === "running" || sampleStatus === "downloading" || sampleStatus === "loading"}
              >
                {sampleLabel}
              </button>
            )}

            {sampleProgressText && (
              <p className="landing-start-note">{sampleProgressText}</p>
            )}
            {previewProgressText && (
              <p className="landing-start-note">{previewProgressText}</p>
            )}
            {sampleError && (
              <p className="landing-start-error">{sampleError}</p>
            )}
            {previewError && (
              <p className="landing-start-error">{previewError}</p>
            )}
          </div>

          {isUploaded && genotypeData ? (
            <div className="landing-upload-success" aria-label="Upload success">
              <strong>File parsed successfully</strong>
              <span>{genotypeData.size.toLocaleString()} variants loaded{detectedFormat ? ` from ${detectedFormat}` : ""}.</span>
              {originalFileName && <span>{originalFileName}{formatFileSize(originalFileSize) ? `, ${formatFileSize(originalFileSize)}` : ""}</span>}
              <span>Your raw DNA file stayed in this browser.</span>
            </div>
          ) : (
            <p className="landing-start-note">
              Nothing is uploaded to us. The file picker opens locally, and analysis runs in this browser.
            </p>
          )}

          {previewTraitNames.length > 0 && (
            <div className="landing-preview-results" aria-label="Preview result examples">
              <strong>Preview results ready</strong>
              {previewTraitNames.map((traitName) => (
                <span key={traitName}>{traitName}</span>
              ))}
            </div>
          )}

          <ol className="landing-home-steps">
            <li>Choose your raw DNA file.</li>
            <li>Start with a quick local preview.</li>
            <li>Explore results and ask DNA Chat questions.</li>
          </ol>

          <div className="landing-provider-guides" aria-label="Provider download guides">
            {[
              ["23andMe", "23andme"],
              ["AncestryDNA", "ancestry"],
              ["MyHeritage", "myheritage"],
              ["FTDNA", "ftdna"],
              ["LivingDNA", "livingdna"],
            ].map(([label, provider]) => (
              <a
                key={provider}
                href={`https://monadicdna.com/guide/${provider}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackProviderGuideClicked(provider, "home")}
              >
                {label}
              </a>
            ))}
          </div>

          <p className="landing-start-help">
            Need help getting your raw DNA file?{" "}
            <a
              href={SCHEDULE_CALL_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackGetStartedClicked("schedule_video_call")}
            >
              Book a free call
            </a>
            {" "}or use a provider guide above.{" "}
            <Link href="/raw-dna-guide">
              Share the raw DNA guide
            </Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
