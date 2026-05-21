"use client";

import { useEffect, useRef, useState } from "react";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import LLMChatInline from "../components/LLMChatInline";
import GuidedTour, { hasCompletedTour } from "../components/GuidedTour";
import { dnaChatTour } from "../components/tours/tourContent";
import { useResults } from "../components/ResultsContext";
import { ResultsManager } from "@/lib/results-manager";
import { trackDNAChatViewed } from "@/lib/analytics";

const SAMPLE_RESULTS_FILE_NAME = "monadic_dna_explorer_results_2026-05-19.tsv";

type SampleLoadState = {
  status: "idle" | "downloading" | "loading" | "loaded" | "skipped" | "error";
  downloadedBytes: number;
  totalBytes: number;
  resultCount: number;
  error: string | null;
};

const initialSampleLoadState: SampleLoadState = {
  status: "idle",
  downloadedBytes: 0,
  totalBytes: 0,
  resultCount: 0,
  error: null,
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DNAChatPage() {
  const { addResultsBatch, clearResults, savedResults } = useResults();
  const [tourOpen, setTourOpen] = useState(false);
  const [sampleLoad, setSampleLoad] = useState<SampleLoadState>(initialSampleLoadState);
  const sampleLoadStartedRef = useRef(false);

  useEffect(() => {
    trackDNAChatViewed();
  }, []);

  useEffect(() => {
    if (!hasCompletedTour(dnaChatTour.id)) {
      setTourOpen(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || sampleLoadStartedRef.current) return;

    const url = new URL(window.location.href);
    const shouldLoadSample = url.searchParams.get("sample") === "1";

    if (!shouldLoadSample) return;

    sampleLoadStartedRef.current = true;
    url.searchParams.delete("sample");
    window.history.replaceState({}, "", url.toString());

    const loadSampleResults = async () => {
      if (savedResults.length > 0) {
        setSampleLoad({
          status: "skipped",
          downloadedBytes: 0,
          totalBytes: 0,
          resultCount: savedResults.length,
          error: null,
        });
        return;
      }

      try {
        setSampleLoad({ ...initialSampleLoadState, status: "downloading" });

        const response = await fetch("/api/sample-results", { method: "GET" });
        if (!response.ok) {
          throw new Error(`Sample results download failed with status ${response.status}.`);
        }

        const totalBytes = Number(response.headers.get("content-length") || "0");
        const decoder = new TextDecoder();
        let content = "";
        let downloadedBytes = 0;

        if (response.body) {
          const reader = response.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            downloadedBytes += value.byteLength;
            content += decoder.decode(value, { stream: true });
            setSampleLoad({
              status: "downloading",
              downloadedBytes,
              totalBytes,
              resultCount: 0,
              error: null,
            });
          }

          content += decoder.decode();
        } else {
          content = await response.text();
          downloadedBytes = new Blob([content]).size;
        }

        setSampleLoad({
          status: "loading",
          downloadedBytes,
          totalBytes: totalBytes || downloadedBytes,
          resultCount: 0,
          error: null,
        });

        const session = ResultsManager.parseResultsFile(content, SAMPLE_RESULTS_FILE_NAME);
        if (!session.results.length) {
          throw new Error("The sample results file did not contain any usable results.");
        }

        await clearResults();
        await addResultsBatch(session.results);
        localStorage.setItem("dna_chat_sample_results_loaded", "true");

        setSampleLoad({
          status: "loaded",
          downloadedBytes,
          totalBytes: totalBytes || downloadedBytes,
          resultCount: session.results.length,
          error: null,
        });
      } catch (error) {
        console.error("[DNA Chat] Sample results load failed:", error);
        setSampleLoad({
          status: "error",
          downloadedBytes: 0,
          totalBytes: 0,
          resultCount: 0,
          error: error instanceof Error ? error.message : "Sample results could not be loaded.",
        });
      }
    };

    void loadSampleResults();
  }, [addResultsBatch, clearResults, savedResults.length]);

  const sampleProgress = sampleLoad.totalBytes > 0
    ? Math.min(100, Math.round((sampleLoad.downloadedBytes / sampleLoad.totalBytes) * 100))
    : 0;

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page premium-feature-page dna-chat-page">
        <section className="premium-section premium-feature-section dna-chat-section">
          {(sampleLoad.status === "downloading" || sampleLoad.status === "loading") && (
            <div className="dna-chat-sample-notice loading">
              <div>
                <strong>{sampleLoad.status === "downloading" ? "Downloading sample results" : "Loading sample results"}</strong>
                <span>
                  {sampleLoad.status === "downloading"
                    ? sampleLoad.totalBytes > 0
                      ? `${sampleProgress}% downloaded, ${formatBytes(sampleLoad.downloadedBytes)} of ${formatBytes(sampleLoad.totalBytes)}`
                      : `${formatBytes(sampleLoad.downloadedBytes)} downloaded`
                    : "Preparing the sample results for DNA Chat."}
                </span>
              </div>
              <div className="wire-progress-bar">
                <span style={{ width: `${sampleLoad.status === "loading" ? 100 : sampleProgress}%` }} />
              </div>
            </div>
          )}

          {sampleLoad.status === "loaded" && (
            <div className="dna-chat-sample-notice ready">
              <div>
                <strong>Sample data loaded.</strong>
                <span>Using {sampleLoad.resultCount.toLocaleString()} sample results. To use your own DNA, click My Data, upload your file, then click Run All.</span>
                <br/>
                <span>No DNA test yet? <a href="https://docs.google.com/forms/d/e/1FAIpQLSdHFDpsyU0t6PlaXEkbHX-pwF_y7icuPJeOHyGHMDpe11XigQ/viewform?usp=sharing&ouid=117844628488835974298" target="_blank" rel="noopener noreferrer" className="dna-chat-sample-notice-link">Sign up</a>  for a private, anonymous DNA test with us. We do not store or resell your data.</span>
                <br/>
              </div>
            </div>
          )}

          {sampleLoad.status === "skipped" && (
            <div className="dna-chat-sample-notice ready">
              <div>
                <strong>Your results are loaded.</strong>
                <span>DNA Chat will use the results in this browser session.</span>
              </div>
            </div>
          )}

          {sampleLoad.status === "error" && (
            <div className="dna-chat-sample-notice error">
              <div>
                <strong>Sample results could not be loaded.</strong>
                <span>{sampleLoad.error}</span>
              </div>
            </div>
          )}

          <LLMChatInline />
        </section>
      </main>
      <Footer />
      <GuidedTour tour={dnaChatTour} isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
