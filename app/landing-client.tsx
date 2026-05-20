"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGenotype } from "./components/UserDataUpload";
import { trackGetStartedClicked } from "@/lib/analytics";


const INSTRUCTIONAL_VIDEO_URL = "https://youtu.be/1mqLYTAOK90";
const SCHEDULE_CALL_URL = "https://calendar.app.google/eVDN4d44GreUjR8p8";
const NEW_USER_CHOICE_STORAGE_KEY = "new_user_choice_completed";
const MOTHBALLED_ONBOARDING_STORAGE_KEY = "conversion_onboarding_completed";

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

function NewUserChoiceModal({
  isOpen,
  onClose,
  onTryChat,
}: {
  isOpen: boolean;
  onClose: () => void;
  onTryChat: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="wire-onboarding-overlay">
      <div className="wire-onboarding-shell">
        <div className="wire-onboarding-frame">
          <button
            className="wire-onboarding-close"
            onClick={onClose}
            aria-label="Close welcome options"
          >
            ✕
          </button>
          <div className="wire-onboarding-step">Welcome</div>
          <section className="wire-onboarding-slide new-user-choice-slide">
            <h1>Start with the full app overview or try DNA Chat with sample results.</h1>
            <p>
              You can learn how Monadic DNA Explorer works first, or jump straight into
              DNA Chat with a prepared result set.
            </p>
            <div className="wire-onboarding-choice-list new-user-choice-list">
              <button
                className="wire-onboarding-choice"
                onClick={onClose}
                type="button"
              >
                Go to the home page
              </button>
              <button
                className="wire-onboarding-choice"
                onClick={onTryChat}
                type="button"
              >
                Try DNA Chat directly
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function LandingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { error } = useGenotype();
  const [showWelcomeChoice, setShowWelcomeChoice] = useState(false);

  const completeWelcomeChoice = useCallback(() => {
    localStorage.setItem(NEW_USER_CHOICE_STORAGE_KEY, "true");
    localStorage.setItem(MOTHBALLED_ONBOARDING_STORAGE_KEY, "true");
    setShowWelcomeChoice(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const completed = localStorage.getItem(NEW_USER_CHOICE_STORAGE_KEY) === "true";
    const forceOpen = searchParams.get("onboarding") === "1";

    if (forceOpen || !completed) {
      setShowWelcomeChoice(true);
    }

    if (forceOpen) {
      const url = new URL(window.location.href);
      url.searchParams.delete("onboarding");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  useEffect(() => {
    const handleOpen = () => {
      setShowWelcomeChoice(true);
    };

    window.addEventListener("openConversionOnboarding", handleOpen as EventListener);
    window.addEventListener("openNewUserChoiceModal", handleOpen as EventListener);
    return () => {
      window.removeEventListener("openConversionOnboarding", handleOpen as EventListener);
      window.removeEventListener("openNewUserChoiceModal", handleOpen as EventListener);
    };
  }, []);

  return (
    <>
      <NewUserChoiceModal
        isOpen={showWelcomeChoice}
        onClose={completeWelcomeChoice}
        onTryChat={() => {
          completeWelcomeChoice();
          trackGetStartedClicked("try_dna_chat_directly");
          router.push("/dna-chat?sample=1");
        }}
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
                  trackGetStartedClicked("welcome_options");
                  setShowWelcomeChoice(true);
                }}
              >
                Choose How to Start
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
                Book a Free Help Call
              </a>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
