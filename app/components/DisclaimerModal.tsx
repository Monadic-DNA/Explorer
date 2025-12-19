"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DisclaimerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  type: 'initial' | 'result';
  onAccept?: () => void;
};

export default function DisclaimerModal({ isOpen, onClose, type, onAccept }: DisclaimerModalProps) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Removed granular modal tracking - no longer needed
    } else {
      setHasScrolledToBottom(false);
    }
  }, [isOpen, type]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    // More generous threshold for reaching bottom
    const threshold = 30;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

    // Also check if content is shorter than container (no scrolling needed)
    const needsScrolling = scrollHeight > clientHeight;

    if (isAtBottom || !needsScrolling) {
      setHasScrolledToBottom(true);
    }
  };

  // Check on mount if scrolling is needed
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        const disclaimerElement = document.querySelector('.disclaimer-text');
        if (disclaimerElement) {
          const { scrollHeight, clientHeight } = disclaimerElement;
          if (scrollHeight <= clientHeight + 10) {
            setHasScrolledToBottom(true);
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const initialContent = (
    <div className="modal-content">
      <h2>⚠️ Important Medical Disclaimer</h2>
      <div className="disclaimer-text" onScroll={handleScroll}>
        <p><strong>This is an entertainment and educational application only.</strong></p>

        <p>Monadic DNA Explorer is designed for entertainment, curiosity, and educational purposes. It is <strong>NOT</strong> a medical device, diagnostic tool, or healthcare application.</p>

        <h3>Critical Understanding:</h3>
        <ul>
          <li><strong>Genetics is extremely complex</strong> - thousands of genetic variants, environmental factors, lifestyle choices, and chance all influence health outcomes</li>
          <li><strong>No single genetic variant determines your fate</strong> - these are statistical associations in large populations, not individual predictions</li>
          <li><strong>Risk percentages are population averages</strong> - your personal risk depends on many factors not captured here</li>
          <li><strong>Protective variants don't guarantee immunity</strong> - favorable genetics don't override other risk factors</li>
        </ul>

        <h3>Do NOT use this app to:</h3>
        <ul>
          <li>Make medical decisions</li>
          <li>Start or stop medications</li>
          <li>Skip medical screenings</li>
          <li>Self-diagnose conditions</li>
          <li>Worry about future health outcomes</li>
        </ul>

        <h3>What you SHOULD do:</h3>
        <ul>
          <li><strong>Consult qualified healthcare professionals</strong> for any health concerns</li>
          <li><strong>Follow established medical guidelines</strong> for screenings and prevention</li>
          <li><strong>Focus on proven health strategies</strong> - diet, exercise, not smoking, etc.</li>
          <li><strong>Remember this is for fun</strong> - take results with a large grain of salt</li>
        </ul>

        <p><strong>By continuing, you acknowledge that you understand these limitations and will not use this application for medical purposes.</strong></p>
      </div>
      <div className="modal-actions">
        <button
          className="disclaimer-button primary"
          onClick={() => {
            if (onAccept) {
              onAccept();
            } else {
              onClose();
            }
          }}
          disabled={!hasScrolledToBottom}
        >
          {hasScrolledToBottom ? 'I Understand - Continue' : 'Please scroll to continue'}
        </button>
      </div>
    </div>
  );

  const resultContent = (
    <div className="modal-content">
      <h2>🧬 Before Viewing Your Results</h2>
      <div className="disclaimer-text" onScroll={handleScroll}>
        <p><strong>Please remember these important caveats:</strong></p>

        <h3>Genetics Reality Check:</h3>
        <ul>
          <li><strong>Complexity beyond belief</strong> - Your traits result from intricate interactions between thousands of genes, environmental factors, lifestyle choices, and pure chance</li>
          <li><strong>Population vs. individual</strong> - These associations were found in large groups and may not apply to you personally</li>
          <li><strong>One piece of a massive puzzle</strong> - Each genetic variant is just one tiny influence among many</li>
        </ul>

        <h3>Take Results With Skepticism:</h3>
        <ul>
          <li><strong>No genetic destiny</strong> - Higher risk doesn't mean you'll develop a condition</li>
          <li><strong>Lower risk isn't immunity</strong> - Protective variants don't guarantee you're safe</li>
          <li><strong>Context matters enormously</strong> - Your ancestry, lifestyle, and environment all play crucial roles</li>
        </ul>

        <h3>What These Results Can't Tell You:</h3>
        <ul>
          <li>Whether you will or won't develop any condition</li>
          <li>How much specific lifestyle changes will help you</li>
          <li>What medical decisions you should make</li>
          <li>Whether you need genetic counseling or testing</li>
        </ul>

        <p><strong>For any health concerns or questions about genetic risk, consult with qualified healthcare professionals or genetic counselors who can provide personalized, medically appropriate guidance.</strong></p>

        <p className="entertainment-reminder">Remember: This is for entertainment and curiosity. Treat it like a fun science experiment, not a medical consultation!</p>
      </div>
      <div className="modal-actions">
        <button
          className="disclaimer-button secondary"
          onClick={() => {
            onClose();
          }}
        >
          Cancel
        </button>
        <button
          className="disclaimer-button primary"
          onClick={() => {
            (onAccept || onClose)();
          }}
          disabled={!hasScrolledToBottom}
        >
          {hasScrolledToBottom ? 'I Understand - Show Results' : 'Please scroll to continue'}
        </button>
      </div>
    </div>
  );

  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        {type === 'initial' ? initialContent : resultContent}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
