"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGenotype } from "./components/UserDataUpload";
import { useResults } from "./components/ResultsContext";
import { useCustomization, type UserCustomization } from "./components/CustomizationContext";
import { ResultsManager } from "@/lib/results-manager";
import { trackGetStartedClicked, trackSampleDataStarted, trackSampleDataLoaded, trackSampleDataFailed } from "@/lib/analytics";

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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SCHEDULE_CALL_URL = "https://calendar.app.google/eVDN4d44GreUjR8p8";

const featureCopy = [
  {
    label: "Explore",
    href: "/explore",
    text: "Explore your results trait by trait. Browse elevated and protective associations ranked by effect size, and see which traits connect to conditions in your personal and family health history.",
  },
  {
    label: "DNA Chat",
    href: "/dna-chat",
    text: "Ask questions about your genetic results in plain English. Get explanations of specific traits, genes, and what population studies say about your variants.",
  },
  {
    label: "Browse",
    href: "/browse",
    text: "Browse studies from the GWAS Catalog with advanced filtering by trait, sample size, and significance. View a heatmap of your SNP matches across selected studies.",
  },
  {
    label: "Analyze",
    href: "/overview-report",
    text: "Generate AI-written reports that synthesize patterns across your results, surface hypotheses about your biology, and connect findings to your health history. Premium feature.",
  },
  {
    label: "Privacy first",
    href: null,
    text: "Your DNA stays in your browser. We do not store, transmit, or sell your raw genetic data. AI runs in Trusted Execution Environments for maximum anonymity.",
  },
];

export default function LandingClient() {
  const router = useRouter();
  const { error } = useGenotype();
  const { addResultsBatch, clearResults, savedResults } = useResults();
  const { saveCustomization, status: customizationStatus } = useCustomization();
  const [sampleStatus, setSampleStatus] = useState<SampleLoadStatus>("idle");
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleBytes, setSampleBytes] = useState(0);
  const [sampleTotalBytes, setSampleTotalBytes] = useState(0);

  const loadSampleData = async () => {
    trackSampleDataStarted('home');

    if (savedResults.length > 0) {
      router.push("/explore");
      return;
    }

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

  return (
    <main className="page landing-page landing-home-page">
      <section className="landing-home-intro" style={{ display: 'block', padding: '2rem 2.5rem' }}>
        <div className="landing-home-copy">
          <h1 style={{ maxWidth: 'none' }}>Understand your DNA without giving it away.</h1>

          <div className="landing-home-explainer" aria-label="Monadic DNA Explorer features" style={{ maxWidth: 'none' }}>
            {featureCopy.map((item) => (
              <p key={item.label}>
                <span>
                  {item.href ? (
                    <Link href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </span>
                {item.text}
              </p>
            ))}
          </div>

          {error && <p className="landing-upload-error">{error}</p>}

          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                className="secondary-button"
                onClick={loadSampleData}
                disabled={sampleStatus === "downloading" || sampleStatus === "loading"}
                style={{ fontSize: '0.85rem' }}
              >
                {sampleLabel}
              </button>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                No DNA file? Load an example to explore the app.
              </span>
            </div>
            {sampleProgressText && (
              <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {sampleProgressText}
              </p>
            )}
            {sampleError && (
              <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--error)' }}>{sampleError}</p>
            )}
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            New to the app?{' '}
            <a
              href={SCHEDULE_CALL_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}
              onClick={() => trackGetStartedClicked("schedule_video_call")}
            >
              Book a free help call.
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
