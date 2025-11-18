"use client";

import { useState } from "react";
import { trackTermsAcceptance } from "@/lib/analytics";

type TermsAcceptanceModalProps = {
  isOpen: boolean;
  onAccept: () => void;
};

export default function TermsAcceptanceModal({ isOpen, onAccept }: TermsAcceptanceModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isOpen) return null;

  const handleAccept = () => {
    if (dontShowAgain) {
      localStorage.setItem('terms_accepted', 'true');
    }
    trackTermsAcceptance();
    onAccept();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="modal-dialog terms-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <h2>Welcome to Monadic DNA Explorer</h2>

          <div className="terms-text">
            <p className="terms-intro">
              Before you begin, please review and accept our Terms and Conditions and Privacy Policy.
            </p>

            <div className="terms-section">
              <h3>Key Points:</h3>
              <ul>
                <li><strong>Educational & Research Use Only:</strong> This tool is for educational and research purposes, not medical advice or diagnosis.</li>
                <li><strong>Privacy First:</strong> Your genetic data is processed entirely in your browser and never sent to our servers.</li>
                <li><strong>No Data Storage:</strong> We do not store your raw genetic data. Results you save are stored locally in your browser only.</li>
                <li><strong>Age Requirement:</strong> You must be 18 years or older to use this service.</li>
                <li><strong>Third-Party Services:</strong> Optional LLM analysis uses Nillion's privacy-preserving technology. We use Google Analytics for anonymized usage statistics.</li>
              </ul>
            </div>

            <div className="terms-links">
              <p>
                Please read our full{" "}
                <a
                  href="https://github.com/Monadic-DNA/GWASifier/blob/main/terms_and_conditions.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="terms-link"
                >
                  Terms and Conditions
                </a>
                {" "}and{" "}
                <a
                  href="https://github.com/Monadic-DNA/GWASifier/blob/main/privacy_policy.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="terms-link"
                >
                  Privacy Policy
                </a>
                .
              </p>
            </div>

            <div className="terms-acknowledgment">
              <p>
                By clicking "I Accept," you acknowledge that you have read, understood, and agree to be bound by our Terms and Conditions and Privacy Policy.
              </p>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <div className="dont-show-again">
            <input
              type="checkbox"
              id="dont-show-again"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <label htmlFor="dont-show-again">Don't show this again</label>
          </div>
          <button className="disclaimer-button primary" onClick={handleAccept}>
            I Accept
          </button>
        </div>
      </div>
    </div>
  );
}
