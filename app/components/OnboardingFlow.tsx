"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { trackOnboardingStarted, trackOnboardingCompleted, trackOnboardingStepViewed } from "@/lib/analytics";

type OnboardingStep =
  | "welcome"
  | "dna_test_status"
  | "data_availability"
  | "premium_offer"
  | "get_sequenced"
  | "complete";

type UserPath = "explore" | "own_dna" | null;

interface OnboardingFlowProps {
  isOpen: boolean;
  onComplete: (userPath: UserPath, showPremium: boolean) => void;
}

export default function OnboardingFlow({ isOpen, onComplete }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [userPath, setUserPath] = useState<UserPath>(null);
  const [mounted, setMounted] = useState(false);
  const [showSequencingNote, setShowSequencingNote] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      trackOnboardingStarted();
    }
  }, [isOpen]);

  // Track step changes for analytics
  useEffect(() => {
    if (isOpen && mounted && currentStep !== "complete") {
      trackOnboardingStepViewed(currentStep);
    }
  }, [currentStep, isOpen, mounted]);

  if (!isOpen || !mounted) return null;

  const handleExplorePath = () => {
    setUserPath("explore");
    // Researchers go straight to app
    if (dontShowAgain) {
      localStorage.setItem("onboarding_completed", "true");
    }
    localStorage.setItem("user_path", "explore");
    trackOnboardingCompleted("explore");
    onComplete("explore", false);
  };

  const handleOwnDNAPath = () => {
    setUserPath("own_dna");
    // Skip the redundant "DNA test status" question and go straight to data availability
    setCurrentStep("data_availability");
  };

  const handleHasDNATest = () => {
    // Legacy function - kept for compatibility with old component
    setCurrentStep("data_availability");
  };

  const handleNoDNATest = () => {
    // Show get sequenced screen with test dataset instructions
    window.open("https://docs.google.com/forms/d/e/1FAIpQLSdHFDpsyU0t6PlaXEkbHX-pwF_y7icuPJeOHyGHMDpe11XigQ/viewform?usp=header", "_blank");
    setCurrentStep("get_sequenced");
  };

  const handleHasData = () => {
    // Show premium with discount
    setCurrentStep("premium_offer");
  };

  const handleNeedsHelp = () => {
    // Show them instructions but keep onboarding open
    window.open("https://monadicdna.com/guide", "_blank");
    // User can go back or continue when ready
  };

  const handlePremiumSubscribe = () => {
    // Always mark complete after going through full premium flow
    localStorage.setItem("onboarding_completed", "true");
    localStorage.setItem("user_path", "own_dna_premium");
    trackOnboardingCompleted("own_dna_premium");
    onComplete("own_dna", true);
  };

  const handlePremiumSkip = () => {
    // Always mark complete after going through full flow
    localStorage.setItem("onboarding_completed", "true");
    localStorage.setItem("user_path", "own_dna_free");
    trackOnboardingCompleted("own_dna_free");
    onComplete("own_dna", false);
  };

  const handleGetSequenced = () => {
    // Advance to get_sequenced step immediately
    setCurrentStep("get_sequenced");
    // Open form after minimal delay to ensure UI updates first
    setTimeout(() => {
      window.open("https://docs.google.com/forms/d/e/1FAIpQLSdHFDpsyU0t6PlaXEkbHX-pwF_y7icuPJeOHyGHMDpe11XigQ/viewform?usp=header", "_blank");
    }, 50);
  };

  const handleCompleteOnboarding = (path: string) => {
    // Only set completed if "don't show again" is checked or if completing from sequencing note
    if (dontShowAgain || showSequencingNote) {
      localStorage.setItem("onboarding_completed", "true");
    }
    localStorage.setItem("user_path", path);
    trackOnboardingCompleted(path as any);
    onComplete(path.includes("explore") ? "explore" : "own_dna", false);
  };

  const welcomeContent = (
    <div className="onboarding-content">
      <div className="onboarding-header">
        <h2>🧬 Welcome to Monadic DNA Explorer</h2>
        <p className="onboarding-subtitle">
          Explore genetic associations from the GWAS Catalog
        </p>
      </div>

      <div className="onboarding-body">
        <p className="onboarding-question">What brings you here today?</p>

        <div className="onboarding-options">
          <button
            className="onboarding-option-card"
            onClick={handleOwnDNAPath}
          >
            <div className="option-icon">🔬</div>
            <div className="option-content">
              <h3>Analyze My DNA</h3>
              <p>I have or can get genetic data from 23andMe, AncestryDNA, or similar services</p>
            </div>
          </button>

          <button
            className="onboarding-option-card"
            onClick={handleGetSequenced}
          >
            <div className="option-icon">🧬</div>
            <div className="option-content">
              <h3>Get Sequenced by Monadic DNA</h3>
              <p>I want to get my DNA sequenced and then analyze it in this app</p>
            </div>
          </button>

          <button
            className="onboarding-option-card secondary"
            onClick={handleExplorePath}
          >
            <div className="option-icon">📊</div>
            <div className="option-content">
              <h3>Explore Genetic Traits</h3>
              <p>I want to browse and research genetic studies from the GWAS Catalog</p>
            </div>
          </button>
        </div>

        {showSequencingNote && (
          <div className="onboarding-info-box" style={{ marginTop: '1.5rem' }}>
            <p>✓ Sequencing form opened in new tab!</p>
            <p style={{ fontWeight: 'normal', marginTop: '0.5rem' }}>
              While you wait for your kit, feel free to explore genetic traits and studies in the app.
            </p>
            <button
              className="onboarding-cta-button primary"
              style={{ marginTop: '1rem', maxWidth: '100%' }}
              onClick={() => handleCompleteOnboarding("get_sequenced")}
            >
              Continue to Explorer
            </button>
          </div>
        )}

        <div className="onboarding-footer-section">
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="onboarding-checkbox"
            />
            <span>Don't show this onboarding again</span>
          </label>
        </div>
      </div>
    </div>
  );

  const dnaTestStatusContent = (
    <div className="onboarding-content">
      <div className="onboarding-header">
        <h2>DNA Test Status</h2>
        <p className="onboarding-subtitle">
          First, let's check if you have genetic data
        </p>
      </div>

      <div className="onboarding-body">
        <p className="onboarding-question">
          Have you completed a DNA test with 23andMe, AncestryDNA, or a similar service?
        </p>

        <div className="onboarding-options">
          <button
            className="onboarding-option-card"
            onClick={handleHasDNATest}
          >
            <div className="option-icon">✅</div>
            <div className="option-content">
              <h3>Yes, I've done a DNA test</h3>
              <p>I have or can get my raw genetic data file</p>
            </div>
          </button>

          <button
            className="onboarding-option-card secondary"
            onClick={handleNoDNATest}
          >
            <div className="option-icon">📖</div>
            <div className="option-content">
              <h3>No, I haven't tested yet</h3>
              <p>Show me how to get genetic data</p>
            </div>
          </button>
        </div>

        <div className="onboarding-footer-buttons">
          <button className="onboarding-back-button" onClick={() => setCurrentStep("welcome")}>
            ← Back
          </button>
          <button
            className="onboarding-text-button"
            onClick={() => handleCompleteOnboarding("explore")}
          >
            Continue to Explorer →
          </button>
        </div>
      </div>
    </div>
  );

  const dataAvailabilityContent = (
    <div className="onboarding-content">
      <div className="onboarding-header">
        <h2>Data File Ready?</h2>
        <p className="onboarding-subtitle">
          Almost there! Let's make sure you have your data file
        </p>
      </div>

      <div className="onboarding-body">
        <p className="onboarding-question">
          Do you already have a copy of your raw genetic data file?
        </p>

        <div className="onboarding-info-box">
          <p><strong>📁 Supported formats:</strong></p>
          <ul>
            <li>23andMe: .txt file</li>
            <li>AncestryDNA: .txt file</li>
            <li>Monadic DNA: .txt, .csv, .tsv</li>
          </ul>
        </div>

        <div className="onboarding-options">
          <button
            className="onboarding-option-card"
            onClick={handleHasData}
          >
            <div className="option-icon">✅</div>
            <div className="option-content">
              <h3>Yes, I have my data file</h3>
              <p>I'm ready to upload and analyze</p>
            </div>
          </button>

          <button
            className="onboarding-option-card secondary"
            onClick={handleNeedsHelp}
          >
            <div className="option-icon">📖</div>
            <div className="option-content">
              <h3>I need help getting my data</h3>
              <p>Show me step-by-step instructions</p>
            </div>
          </button>
        </div>

        <div className="onboarding-footer-buttons">
          <button className="onboarding-back-button" onClick={() => setCurrentStep("welcome")}>
            ← Back
          </button>
          <button
            className="onboarding-text-button"
            onClick={() => handleCompleteOnboarding("explore")}
          >
            Continue to Explorer →
          </button>
        </div>
      </div>
    </div>
  );

  const premiumOfferContent = (
    <div className="onboarding-content">
      <div className="onboarding-header">
        <h2>🎉 Special Welcome Offer</h2>
        <p className="onboarding-subtitle">
          Get Premium features with your first week free!
        </p>
      </div>

      <div className="onboarding-body">
        <div className="premium-offer-box">
          <div className="premium-badge">WELCOME DISCOUNT</div>
          <h3>🎁 Get Your First Week Free</h3>

          <div className="coupon-code-section">
            <p className="coupon-label">Your coupon code:</p>
            <div className="coupon-code-box">
              <code className="coupon-code">FREEWEEK</code>
              <button
                className="copy-button"
                onClick={() => {
                  navigator.clipboard.writeText('FREEWEEK');
                }}
                title="Copy to clipboard"
              >
                📋 Copy
              </button>
            </div>
          </div>

          <div className="premium-features-compact">
            <div className="premium-feature-compact">⚡ Run all 1M+ trait analyses</div>
            <div className="premium-feature-compact">💬 LLM chat about your genetics</div>
            <div className="premium-feature-compact">📋 Comprehensive AI reports</div>
          </div>

          <p className="coupon-instructions">
            Click "Continue to Explorer" below, then go to the Premium tab and enter this code at checkout.
          </p>
        </div>

        <div className="onboarding-options centered">
          <button
            className="onboarding-cta-button primary"
            onClick={handlePremiumSkip}
          >
            Continue to Explorer
          </button>

          <button
            className="onboarding-text-button"
            onClick={() => setCurrentStep("welcome")}
          >
            ← Go Back
          </button>
        </div>
      </div>
    </div>
  );

  const getSequencedContent = (
    <div className="onboarding-content">
      <div className="onboarding-header">
        <h2>🧬 Get Sequenced by Monadic DNA</h2>
        <p className="onboarding-subtitle">
          We've opened the sequencing form in a new tab
        </p>
      </div>

      <div className="onboarding-body">
        <div className="onboarding-info-box">
          <p>✓ While you wait for your DNA kit to arrive and results to come back, you can test drive the app with a sample dataset!</p>
        </div>

        <div className="test-dataset-instructions">
          <h3>Try the App Now with Test Data</h3>
          <ol>
            <li>Download this test dataset: <a href="https://drive.google.com/file/d/1WK3zZbqmu3_m6LvoQCylyIbWBkoO5pGI/view?usp=sharing" target="_blank" rel="noopener noreferrer" className="download-link">GFGFilteredUnphasedGenotypes23andMe.zip</a></li>
            <li>Click "Continue to Explorer" below</li>
            <li>Go to the "Upload DNA" tab</li>
            <li>Upload the sample file to see how the analysis works</li>
          </ol>
        </div>

        <div className="onboarding-options centered">
          <button
            className="onboarding-cta-button primary"
            onClick={() => {
              if (dontShowAgain) {
                localStorage.setItem("onboarding_completed", "true");
              }
              localStorage.setItem("user_path", "get_sequenced");
              trackOnboardingCompleted("own_dna_no_test");
              onComplete("explore", false);
            }}
          >
            Continue to Explorer
          </button>

          <button
            className="onboarding-text-button"
            onClick={() => setCurrentStep("welcome")}
          >
            ← Go Back
          </button>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (currentStep) {
      case "welcome":
        return welcomeContent;
      case "dna_test_status":
        return dnaTestStatusContent;
      case "data_availability":
        return dataAvailabilityContent;
      case "premium_offer":
        return premiumOfferContent;
      case "get_sequenced":
        return getSequencedContent;
      default:
        return null;
    }
  };

  const modalContent = (
    <div className="modal-overlay onboarding-overlay">
      <div className="modal-dialog onboarding-dialog">
        {renderContent()}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
