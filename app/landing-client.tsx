"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ConversionOnboarding from "./components/ConversionOnboarding";
import { useGenotype } from "./components/UserDataUpload";
import { trackGetStartedClicked } from "@/lib/analytics";

type FlowMode = "guided" | "instant_preview";

const INSTRUCTIONAL_VIDEO_URL = "https://youtu.be/1mqLYTAOK90";
const SCHEDULE_CALL_URL = "https://calendar.app.google/eVDN4d44GreUjR8p8";

const introCopy = [
  {
    label: "DNA insights",
    text: "Monadic DNA Explorer lets you unlock the potential of DNA data to inform diet, lifestyle, and health.",
  },
  {
    label: "GWAS Catalog",
    text: "We use over one million scientifically vetted traits from the GWAS Catalog to help you understand your DNA.",
  },
  {
    label: "Privacy first",
    text: "Your DNA is the most sensitive data you own, so we ensure your data stays private and secure. We do not store, snoop on, or sell your data.",
  },
  {
    label: "Secure AI",
    text: "Using local processing in your browser and AI running in Trusted Execution Environments, we maximize your anonymity and privacy.",
  },
];

export default function LandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isUploaded, error } = useGenotype();
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

  return (
    <>
      <ConversionOnboarding
        isOpen={showFlow}
        mode={flowMode}
        onComplete={() => {
          setShowFlow(false);
          router.push("/explore");
        }}
        onDismiss={() => setShowFlow(false)}
      />

      <main className="page landing-page landing-home-page">
        <section className="landing-home-intro">
          <div className="landing-home-copy">
            <h1>Understand your DNA without giving it away.</h1>

            <div className="landing-home-explainer" aria-label="Monadic DNA Explorer overview">
              {introCopy.map((item) => (
                <p key={item.label}>
                  <span>{item.label}</span>
                  {item.text}
                </p>
              ))}
            </div>

            {error && <p className="landing-upload-error">{error}</p>}
          </div>

          <aside className="landing-home-start-panel" aria-labelledby="landing-start-heading">
            <h2 id="landing-start-heading">Get Started</h2>
            <div className="landing-start-actions">
              <button
                className="landing-secondary-button"
                onClick={() => {
                  trackGetStartedClicked("onboarding_tour");
                  openOnboarding(isUploaded ? "instant_preview" : "guided");
                }}
              >
                Take an Onboarding Tour
              </button>
              <a
                className="landing-secondary-button"
                href={INSTRUCTIONAL_VIDEO_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackGetStartedClicked("instructional_video")}
              >
                Watch Instructional Video
              </a>
              <a
                className="landing-secondary-button"
                href={SCHEDULE_CALL_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackGetStartedClicked("schedule_video_call")}
              >
                Schedule Video Call
              </a>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
