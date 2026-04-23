"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ConversionOnboarding from "./components/ConversionOnboarding";
import { useGenotype } from "./components/UserDataUpload";

type ReferralContext = {
  badge: string;
  headline: string;
  subheadline: string;
};

const DEFAULT_REFERRAL: ReferralContext = {
  badge: "privacy-first DNA explorer",
  headline: "Upload your DNA. Get an immediate private preview. No signup wall.",
  subheadline: "First-time users should see value before friction: Run All analysis first, then secure AI answers powered directly from your browser.",
};

function inferReferralContext(searchParams: URLSearchParams, referrer: string): ReferralContext {
  const utmSource = searchParams.get("utm_source")?.toLowerCase();
  const ref = searchParams.get("ref")?.toLowerCase();
  const source = utmSource || ref || referrer.toLowerCase();

  if (source.includes("reddit")) {
    return {
      badge: "for skeptical Reddit traffic",
      headline: "Check the genetics evidence yourself before trusting anyone else’s summary.",
      subheadline: "Upload a raw file, run the matching locally, and see a secure AI preview without giving up identity or handing your DNA to our servers.",
    };
  }

  if (source.includes("x") || source.includes("twitter")) {
    return {
      badge: "for social traffic",
      headline: "Turn a genetics thread into something you can actually test on your own data.",
      subheadline: "The fast path is simple: upload raw DNA, run the preview, and decide later whether the deeper product is worth keeping.",
    };
  }

  return DEFAULT_REFERRAL;
}

type FlowMode = "guided" | "instant_preview";

export default function LandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isUploaded, error, originalFileName } = useGenotype();
  const [referralContext, setReferralContext] = useState<ReferralContext>(DEFAULT_REFERRAL);
  const [showFlow, setShowFlow] = useState(false);
  const [flowMode, setFlowMode] = useState<FlowMode>("guided");

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const referrer = typeof document === "undefined" ? "" : document.referrer;
    setReferralContext(inferReferralContext(params, referrer));
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const completed = localStorage.getItem("conversion_onboarding_completed") === "true";
    setShowFlow(!completed);
  }, []);

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

      <main className="page landing-page landing-page-tight">
        <section className="landing-focus-hero landing-underlay-shell">
          <div className="landing-focus-copy">
            <span className="landing-badge">{referralContext.badge}</span>
            <h1>{referralContext.headline}</h1>
            <p>{referralContext.subheadline}</p>

            <div className="landing-privacy-strip">
              <span>Anonymous first run</span>
              <span>Raw DNA parsed in-browser</span>
              <span>Secure AI via nilAI TEE</span>
            </div>

            {error && <p className="landing-upload-error">{error}</p>}

            {isUploaded && (
              <div className="landing-loaded-note">
                <strong>{originalFileName || "DNA file loaded"}</strong>
                <span>Your results context is already loaded and ready to use.</span>
              </div>
            )}
            <div className="landing-underlay-actions">
              <button
                className="landing-primary-button"
                onClick={() => {
                  setFlowMode(isUploaded ? "instant_preview" : "guided");
                  setShowFlow(true);
                }}
              >
                {isUploaded ? "Resume guided preview" : "Open guided preview"}
              </button>
              <button className="landing-text-button" onClick={() => router.push("/explore")}>
                Enter the app directly
              </button>
            </div>
          </div>

          <div className="landing-underlay-panels">
            <article className="landing-proof-card">
              <h3>The exact preview path</h3>
              <p>Upload a raw DNA file, run the onboarding preview analysis, pick five interesting traits, then read five secure AI explanations.</p>
            </article>
            <article className="landing-proof-card">
              <h3>Privacy is not buried</h3>
              <p>Your raw DNA is parsed locally, the first run is anonymous, and the AI step is explicit, consent-gated, and TEE-backed.</p>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
