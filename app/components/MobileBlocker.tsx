"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export default function MobileBlocker() {
  const [mounted, setMounted] = useState(false);
  const [showAnyway, setShowAnyway] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  // If user chose to view on mobile anyway, don't show blocker
  if (showAnyway) {
    return null;
  }

  return (
    <div className="mobile-blocker">
      <div className="mobile-blocker-content">
        {/* Header with Logo */}
        <div className="mobile-blocker-header">
          <div className="mobile-blocker-logo">
            <Image
              src="/explorer-logo-transparent.png"
              alt="Monadic DNA Explorer"
              width={200}
              height={200}
              priority
              style={{ objectFit: 'contain' }}
            />
          </div>
          <h1 className="mobile-blocker-title">
            Monadic DNA Explorer
          </h1>
          <p className="mobile-blocker-subtitle">
            Built for desktops and laptops
          </p>
        </div>

        {/* Message */}
        <div className="mobile-blocker-message">
          <p>
            <strong>Explorer</strong> provides a powerful, data-rich interface for exploring genetic studies
            and analyzing your DNA data. For the best experience with complex visualizations and large datasets,
            please visit us on a desktop or laptop computer.
          </p>
        </div>

        {/* Privacy & Security Highlight */}
        <div className="mobile-blocker-security">
          <div className="security-badge">
            <svg className="security-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L4 6V11C4 16.55 7.84 21.74 12 23C16.16 21.74 20 16.55 20 11V6L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="security-text">
              <strong>100% Private & Secure</strong>
              <p>All DNA analysis happens in your browser. Zero uploads to servers. Your genetic data never leaves your device.</p>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mobile-blocker-features">
          <div className="mobile-blocker-feature">
            <svg className="feature-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 2V4M12 20V22M4 12H2M22 12H20M6.34 6.34L4.93 4.93M19.07 19.07L17.66 17.66M6.34 17.66L4.93 19.07M19.07 4.93L17.66 6.34" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h3>Explore 1M+ Studies</h3>
            <p>Search the entire GWAS Catalog with semantic similarity and advanced filters</p>
          </div>

          <div className="mobile-blocker-feature">
            <svg className="feature-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3C12 3 8 6 8 10C8 12.21 9.79 14 12 14C14.21 14 16 12.21 16 10C16 6 12 3 12 3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 14V21M9 18H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h3>Analyze Your DNA</h3>
            <p>Upload 23andMe or AncestryDNA files for personalized genetic insights — processed locally</p>
          </div>

          <div className="mobile-blocker-feature">
            <svg className="feature-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="12" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/>
            </svg>
            <h3>AI-Powered Chat</h3>
            <p>Ask an LLM questions about your genetic data with complete privacy and security</p>
          </div>

          <div className="mobile-blocker-feature">
            <svg className="feature-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h3>Run All Analysis</h3>
            <p>Test your genome against all 1M+ traits in the catalog instantly — offline-capable</p>
          </div>

          <div className="mobile-blocker-feature">
            <svg className="feature-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2V8H20M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h3>Overview Report</h3>
            <p>Generate comprehensive AI-powered reports analyzing patterns across all your genetic traits</p>
          </div>

          <div className="mobile-blocker-feature">
            <svg className="feature-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85781 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h3>Quality Filtering</h3>
            <p>Advanced study reliability metrics and confidence indicators for evidence-based insights</p>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="mobile-blocker-cta">
          <button
            className="mobile-blocker-button primary"
            onClick={() => {
              // Copy current URL to clipboard
              if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
                alert('✓ Link copied to clipboard! Open on desktop.');
              }
            }}
          >
            Copy Link for Desktop
          </button>

          <a
            href="https://monadicdna.com"
            className="mobile-blocker-button secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn More About Our Products
          </a>

          <button
            className="mobile-blocker-link"
            onClick={() => setShowAnyway(true)}
          >
            View on mobile anyway →
          </button>
        </div>

        {/* Footer note */}
        <div className="mobile-blocker-footer">
          <p>
            <strong>Privacy-first by design.</strong> Your genetic data is processed entirely in your browser
            using WebAssembly and IndexedDB. We never upload, store, or transmit your DNA data to any servers.
            All analysis is performed locally on your device for complete privacy and security.
          </p>
        </div>
      </div>
    </div>
  );
}
