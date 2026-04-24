"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ConversionOnboarding from "./components/ConversionOnboarding";
import { useGenotype } from "./components/UserDataUpload";
import { useResults } from "./components/ResultsContext";

type FlowMode = "guided" | "instant_preview";

export default function LandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { genotypeData, isUploaded, error, originalFileName } = useGenotype();
  const { savedResults } = useResults();
  const [showFlow, setShowFlow] = useState(false);
  const [flowMode, setFlowMode] = useState<FlowMode>("guided");

  const openOnboarding = useCallback((mode: FlowMode = "guided") => {
    setFlowMode(mode);
    setShowFlow(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const completed = localStorage.getItem("conversion_onboarding_completed") === "true";
    const forceOpen = searchParams.get("onboarding") === "1";

    if (forceOpen || !completed) {
      setFlowMode(forceOpen ? "guided" : isUploaded ? "instant_preview" : "guided");
      setShowFlow(true);
    }

    if (forceOpen) {
      const url = new URL(window.location.href);
      url.searchParams.delete("onboarding");
      window.history.replaceState({}, "", url.toString());
    }
  }, [isUploaded, searchParams]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: FlowMode }>;
      openOnboarding(customEvent.detail?.mode || "guided");
    };

    window.addEventListener("openConversionOnboarding", handleOpen as EventListener);
    return () => {
      window.removeEventListener("openConversionOnboarding", handleOpen as EventListener);
    };
  }, [openOnboarding]);

  const homeStatus = useMemo(() => {
    return [
      {
        label: "DNA Data",
        value: isUploaded && genotypeData ? `${genotypeData.size.toLocaleString()} variants loaded` : "No DNA file loaded yet",
        detail: isUploaded ? (originalFileName || "Your current file is ready for analysis.") : "Upload your raw file or use the onboarding sample path.",
      },
      {
        label: "Results Cache",
        value: savedResults.length ? `${savedResults.length.toLocaleString()} saved results` : "No saved results yet",
        detail: savedResults.length ? "Jump into Explore to filter, inspect, and export your results." : "Run the onboarding preview or explore the catalog directly.",
      },
      {
        label: "Privacy Model",
        value: "Local raw DNA, explicit AI consent",
        detail: "Your raw DNA is parsed in-browser. Secure AI remains optional and consent-gated.",
      },
    ];
  }, [genotypeData, isUploaded, originalFileName, savedResults.length]);

  return (
    <>
      <ConversionOnboarding
        isOpen={showFlow}
        mode={flowMode}
        onComplete={() => {
          setShowFlow(false);
          router.push("/explore");
        }}
      />

      <main className="page landing-page landing-home-page">
        <section className="landing-home-hero">
          <div className="landing-home-copy">
            <span className="landing-badge">private DNA workspace</span>
            <h1>Explore the GWAS catalog, analyze your DNA locally, and use secure AI only when you want it.</h1>
            <p>
              The onboarding flow handles first-time setup. This page should just make the app legible: start the private preview, open the explorer, or load your own data into the workspace.
            </p>

            <div className="landing-privacy-strip">
              <span>Anonymous first run</span>
              <span>Raw DNA stays in-browser</span>
              <span>Secure AI is explicit and optional</span>
            </div>

            {error && <p className="landing-upload-error">{error}</p>}

            <div className="landing-cta-row">
              <button
                className="landing-primary-button"
                onClick={() => openOnboarding(isUploaded ? "instant_preview" : "guided")}
              >
                {isUploaded ? "Resume Private Preview" : "Start Private Preview"}
              </button>
              <button className="landing-secondary-button" onClick={() => router.push("/explore")}>
                Open Explorer
              </button>
              <button
                className="landing-text-button"
                onClick={() => window.dispatchEvent(new CustomEvent("openDNAUpload"))}
              >
                {isUploaded ? "Replace DNA File" : "Upload DNA File"}
              </button>
            </div>
          </div>

          <div className="landing-home-status-grid">
            {homeStatus.map((item) => (
              <article key={item.label} className="landing-home-status-card">
                <span className="landing-home-status-label">{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-home-launch-grid">
          <article className="landing-home-panel landing-home-panel-primary">
            <span className="landing-action-label">First Run</span>
            <h2>Use the onboarding preview to get immediate value before committing to the rest of the app.</h2>
            <p>
              Upload your raw DNA file or follow the sample-data branch. The flow runs a lightweight local preview, shows curated traits, and then lets you try secure AI questions.
            </p>
            <div className="landing-card-actions">
              <button
                className="landing-primary-button compact"
                onClick={() => openOnboarding(isUploaded ? "instant_preview" : "guided")}
              >
                Open Onboarding
              </button>
            </div>
          </article>

          <article className="landing-home-panel">
            <span className="landing-action-label">Research Mode</span>
            <h2>Browse and filter the full GWAS catalog without waiting for the onboarding flow.</h2>
            <p>
              Explore studies directly, inspect variants, and use the app like a research workspace even if you do not have your own DNA file ready yet.
            </p>
            <div className="landing-card-actions">
              <button className="landing-secondary-button compact" onClick={() => router.push("/explore")}>
                Browse Catalog
              </button>
            </div>
          </article>

          <article className="landing-home-panel">
            <span className="landing-action-label">Workspace</span>
            <h2>Manage your own data locally and pick up where you left off.</h2>
            <p>
              Load or replace your DNA file, keep results cached in the browser, and move into deeper exploration or premium chat only when you decide it is worth doing.
            </p>
            <div className="landing-card-actions">
              <button
                className="landing-secondary-button compact"
                onClick={() => window.dispatchEvent(new CustomEvent("openDNAUpload"))}
              >
                {isUploaded ? "Manage My DNA File" : "Load My DNA File"}
              </button>
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
