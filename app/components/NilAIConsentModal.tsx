"use client";

import { useEffect } from "react";

type NilAIConsentModalProps = {
  isOpen: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export default function NilAIConsentModal({
  isOpen,
  onAccept,
  onDecline,
}: NilAIConsentModalProps) {
  // Removed modal tracking - not needed for simplified analytics

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onDecline}>
      <div
        className="modal-dialog consent-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <h2>🛡️ LLM Commentary Privacy Notice</h2>

          <div className="consent-explanation">
            <p>
              Before generating LLM commentary, please understand how your data will be processed:
            </p>

            <div className="consent-details">
              <h3>What Data Will Be Shared:</h3>
              <ul>
                <li>Your specific genotypes for the analyzed SNPs</li>
                <li>The trait/condition being analyzed</li>
                <li>Your calculated risk scores and interpretations</li>
                <li>Study metadata (publication info, effect sizes)</li>
              </ul>

              <h3>Where Your Data Goes:</h3>
              <ul>
                <li>
                  <strong>Directly to Nillion's nilAI service</strong> - Your data is sent from your
                  browser to nilAI's servers (it does NOT pass through our servers)
                </li>
                <li>
                  <strong>Processed in a Trusted Execution Environment (TEE)</strong> - Your data is
                  processed inside a secure enclave that prevents even nilAI operators from accessing
                  the raw data
                </li>
              </ul>

              <h3>Privacy Guarantees:</h3>
              <ul>
                <li>Your genetic data is transmitted over encrypted connections (HTTPS)</li>
                <li>Processing occurs in a hardware-isolated Trusted Execution Environment</li>
                <li>
                  Single-use delegation tokens ensure each request is independently authorized
                </li>
                <li>
                  For nilAI's data retention and privacy policies, visit{" "}
                  <a
                    href="https://nillion.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    nillion.com/privacy
                  </a>
                </li>
              </ul>

              <div className="consent-warning">
                <p>
                  <strong>⚠️ Important:</strong> While we use privacy-preserving technology, sharing
                  genetic data with any external service carries inherent risks. Only proceed if you
                  understand and accept these risks.
                </p>
              </div>
            </div>

          </div>
        </div>

        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => {
              onDecline();
            }}
          >
            Decline
          </button>
          <button
            className="primary"
            onClick={() => {
              onAccept();
            }}
          >
            Accept & Continue
          </button>
        </div>
      </div>
    </div>
  );
}
