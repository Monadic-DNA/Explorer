"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import PremiumFeatureHeader from "../components/PremiumFeatureHeader";
import { PremiumPaywall } from "../components/PremiumPaywall";
import OverviewReportModal from "../components/OverviewReportModal";
import HealthReportModal from "../components/HealthReportModal";
import HealthspanReportModal from "../components/HealthspanReportModal";
import { OverviewReportIcon } from "../components/Icons";
import { useAuth } from "../components/AuthProvider";
import { useResults } from "../components/ResultsContext";
import { hasValidPromoAccess } from "@/lib/promo-access";
import GuidedTour, { hasCompletedTour } from "../components/GuidedTour";
import { overviewReportTour } from "../components/tours/tourContent";
import { trackOverviewReportViewed } from "@/lib/analytics";

export default function OverviewReportPage() {
  const router = useRouter();
  const { savedResults } = useResults();
  const { isAuthenticated, hasActiveSubscription, openAuthModal } = useAuth();
  const [showOverviewReportModal, setShowOverviewReportModal] = useState(false);
  const [showHealthReportModal, setShowHealthReportModal] = useState(false);
  const [showHealthspanReportModal, setShowHealthspanReportModal] = useState(false);
  const [hasPromoAccess, setHasPromoAccess] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    const refreshPromoAccess = () => {
      setHasPromoAccess(hasValidPromoAccess());
    };

    refreshPromoAccess();
    window.addEventListener('premiumAccessUpdated', refreshPromoAccess);
    return () => window.removeEventListener('premiumAccessUpdated', refreshPromoAccess);
  }, []);

  useEffect(() => {
    trackOverviewReportViewed();
  }, []);

  useEffect(() => {
    if (!hasCompletedTour(overviewReportTour.id)) {
      setTourOpen(true);
    }
  }, []);

  const hasPremiumAccess = hasActiveSubscription || hasPromoAccess;
  const hasResults = savedResults.length > 0;

  const requirePremium = () => {
    if (!hasPremiumAccess && !hasValidPromoAccess()) {
      if (!isAuthenticated) { openAuthModal(); return false; }
      router.push('/subscribe');
      return false;
    }
    return true;
  };

  const handleGenerateReport = () => {
    if (!hasResults || !requirePremium()) return;
    setShowOverviewReportModal(true);
  };

  const handleGenerateHealthReport = () => {
    if (!hasResults) return;
    setShowHealthReportModal(true);
  };

  const handleGenerateHealthspanReport = () => {
    if (!hasResults) return;
    setShowHealthspanReportModal(true);
  };

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page premium-feature-page">
        <PremiumFeatureHeader
          featureName="Overview Report"
          description="Generate a synthesized report across your saved genetic results."
        />
        <div style={{ textAlign: "right", padding: "0 1rem" }}>
          <button className="tour-trigger-link" onClick={() => setTourOpen(true)}>
            Take the tour
          </button>
        </div>
        <PremiumPaywall>{null}</PremiumPaywall>

        <section className="premium-section premium-feature-section">
          <div className="premium-feature-intro">
            <div>
              <div className="premium-feature-title-row">
                <h2>Overview Report</h2>
                <span className="premium-tab-badge">Premium</span>
                <span className="experimental-badge">Experimental</span>
              </div>
              <p>
                Turn your saved analysis results into a concise AI-generated
                report covering patterns, themes, and suggested next steps.
              </p>
              <p className="experimental-notice">
                This feature is experimental and is currently under development.
              </p>
            </div>
          </div>

          <div className="overview-report-panel">
            <div className="overview-report-icon">
              <OverviewReportIcon size={56} />
            </div>
            <div className="overview-report-copy">
              <h3>Comprehensive Overview Report</h3>
              <p>
                Analyzes all your saved genetic results across categories: health, lifestyle, appearance, personality, and more. Works best after running broad analysis.
              </p>
              <div className="overview-report-stats">
                <span data-tour="saved-results-count">{savedResults.length.toLocaleString()} saved results</span>
                <span>{hasPremiumAccess ? "Premium access active" : "Premium required"}</span>
              </div>
            </div>
            <div className="overview-report-actions">
              <button
                className="primary-button"
                onClick={handleGenerateReport}
                disabled={!hasResults}
                data-tour="generate-report-button"
              >
                {!hasResults ? "Load Results First" : "Generate Overview Report"}
              </button>
            </div>
          </div>

          <div className="overview-report-panel" style={{ marginTop: '1rem' }}>
            <div className="overview-report-icon" style={{ fontSize: '2.5rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
              🧬
            </div>
            <div className="overview-report-copy">
              <h3>
                Health Insights Report
                <span className="experimental-badge" style={{ marginLeft: '0.5rem' }}>New</span>
              </h3>
              <p>
                Anchors to your personal and family health history. Selects the most relevant genetic associations and identifies the biological mechanisms that may be affecting your health.
              </p>
              <div className="overview-report-stats">
                <span>{savedResults.length.toLocaleString()} saved results</span>
                <span>Single AI call · faster</span>
              </div>
            </div>
            <div className="overview-report-actions">
              <button
                className="primary-button"
                onClick={handleGenerateHealthReport}
                disabled={!hasResults}
              >
                {!hasResults ? "Load Results First" : "Generate Health Insights"}
              </button>
            </div>
          </div>

          <div className="overview-report-panel" style={{ marginTop: '1rem' }}>
            <div className="overview-report-icon" style={{ fontSize: '2.5rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
              📊
            </div>
            <div className="overview-report-copy">
              <h3>
                Healthspan Report
                <span className="experimental-badge" style={{ marginLeft: '0.5rem' }}>New</span>
              </h3>
              <p>
                Organizes your associations by healthspan domain: cardiovascular, metabolic, neurological, immune, musculoskeletal, and cancer susceptibility. Synthesizes patterns within and across domains.
              </p>
              <div className="overview-report-stats">
                <span>{savedResults.length.toLocaleString()} saved results</span>
                <span>6 domains · single AI call</span>
              </div>
            </div>
            <div className="overview-report-actions">
              <button
                className="primary-button"
                onClick={handleGenerateHealthspanReport}
                disabled={!hasResults}
              >
                {!hasResults ? "Load Results First" : "Generate Healthspan Report"}
              </button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <OverviewReportModal
        isOpen={showOverviewReportModal}
        onClose={() => setShowOverviewReportModal(false)}
      />
      <HealthReportModal
        isOpen={showHealthReportModal}
        onClose={() => setShowHealthReportModal(false)}
      />
      <HealthspanReportModal
        isOpen={showHealthspanReportModal}
        onClose={() => setShowHealthspanReportModal(false)}
      />
      <GuidedTour tour={overviewReportTour} isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
