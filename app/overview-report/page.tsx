"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import PremiumFeatureHeader from "../components/PremiumFeatureHeader";
import { PremiumPaywall } from "../components/PremiumPaywall";
import OverviewReportModal from "../components/OverviewReportModal";
import { OverviewReportIcon } from "../components/Icons";
import { useAuth } from "../components/AuthProvider";
import { useResults } from "../components/ResultsContext";
import { hasValidPromoAccess } from "@/lib/promo-access";

export default function OverviewReportPage() {
  const router = useRouter();
  const { savedResults } = useResults();
  const { isAuthenticated, hasActiveSubscription, openAuthModal } = useAuth();
  const [showOverviewReportModal, setShowOverviewReportModal] = useState(false);
  const [hasPromoAccess, setHasPromoAccess] = useState(false);

  useEffect(() => {
    const refreshPromoAccess = () => {
      setHasPromoAccess(hasValidPromoAccess());
    };

    refreshPromoAccess();
    window.addEventListener('premiumAccessUpdated', refreshPromoAccess);
    return () => window.removeEventListener('premiumAccessUpdated', refreshPromoAccess);
  }, []);

  const hasPremiumAccess = hasActiveSubscription || hasPromoAccess;
  const hasResults = savedResults.length > 0;

  const handleGenerateReport = () => {
    if (!hasResults) {
      return;
    }

    if (!hasPremiumAccess && !hasValidPromoAccess()) {
      if (!isAuthenticated) {
        openAuthModal();
        return;
      }

      router.push('/subscribe');
      return;
    }

    setShowOverviewReportModal(true);
  };

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page premium-feature-page">
        <PremiumFeatureHeader
          featureName="Overview Report"
          description="Generate a synthesized report across your saved genetic results."
        />
        <PremiumPaywall>{null}</PremiumPaywall>

        <section className="premium-section premium-feature-section">
          <div className="premium-feature-intro">
            <div>
              <div className="premium-feature-title-row">
                <h2>Overview Report</h2>
                <span className="premium-tab-badge">Premium</span>
              </div>
              <p>
                Turn your saved analysis results into a concise AI-generated
                report covering patterns, themes, and suggested next steps.
              </p>
            </div>
          </div>

          <div className="overview-report-panel">
            <div className="overview-report-icon">
              <OverviewReportIcon size={56} />
            </div>
            <div className="overview-report-copy">
              <h3>Generate your report</h3>
              <p>
                The report works best after you have run broad analysis. Use
                Run All from the Menu Bar or load a saved results file first.
              </p>
              <div className="overview-report-stats">
                <span>{savedResults.length.toLocaleString()} saved results</span>
                <span>{hasPremiumAccess ? "Premium access active" : "Premium required"}</span>
              </div>
            </div>
            <div className="overview-report-actions">
              <button
                className="primary-button"
                onClick={handleGenerateReport}
                disabled={!hasResults}
              >
                {!hasResults ? "Load Results First" : "Generate Overview Report"}
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
    </div>
  );
}
