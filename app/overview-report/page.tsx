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
import TopTraitsReportModal from "../components/TopTraitsReportModal";
import { OverviewReportIcon } from "../components/Icons";
import { useAuth } from "../components/AuthProvider";
import { getAuthToken } from "@dynamic-labs/sdk-react-core";
import { useResults } from "../components/ResultsContext";
import { hasValidPromoAccess } from "@/lib/promo-access";
import GuidedTour from "../components/GuidedTour";
import { overviewReportTour } from "../components/tours/tourContent";
import { trackOverviewReportViewed } from "@/lib/analytics";
import { PAID_REPORT_LABELS, PaidReportType } from "@/lib/report-access";

type ReportAccessCounts = Record<PaidReportType, number>;

const emptyReportAccess: ReportAccessCounts = {
  healthspan: 0,
  top_traits: 0,
  overview: 0,
};

export default function OverviewReportPage() {
  const router = useRouter();
  const { savedResults } = useResults();
  const { isAuthenticated, user, hasActiveSubscription, openAuthModal } = useAuth();
  const [showOverviewReportModal, setShowOverviewReportModal] = useState(false);
  const [showHealthReportModal, setShowHealthReportModal] = useState(false);
  const [showHealthspanReportModal, setShowHealthspanReportModal] = useState(false);
  const [showTopTraitsReportModal, setShowTopTraitsReportModal] = useState(false);
  const [hasPromoAccess, setHasPromoAccess] = useState(false);
  const [reportAccess, setReportAccess] = useState<ReportAccessCounts>(emptyReportAccess);
  const [checkingReportAccess, setCheckingReportAccess] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [purchasingReportType, setPurchasingReportType] = useState<PaidReportType | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const walletAddress = user?.verifiedCredentials?.find((c: any) => c.address)?.address;

  useEffect(() => {
    const refreshPromoAccess = () => {
      setHasPromoAccess(hasValidPromoAccess());
    };

    refreshPromoAccess();
    window.addEventListener('premiumAccessUpdated', refreshPromoAccess);
    return () => window.removeEventListener('premiumAccessUpdated', refreshPromoAccess);
  }, []);

  useEffect(() => {
    trackOverviewReportViewed({
      resultCount: savedResults.length,
      hasResults: savedResults.length > 0,
    });
  }, [savedResults.length]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const purchaseState = params.get('report_purchase');
    const reportType = params.get('report_type');
    const sessionId = params.get('session_id');

    if (!purchaseState) return;

    if (purchaseState === 'success' && reportType && reportType in PAID_REPORT_LABELS) {
      setPurchaseMessage(`${PAID_REPORT_LABELS[reportType as PaidReportType]} is unlocked for one run.`);
      if (sessionId) {
        setCheckoutSessionId(sessionId);
      }
    } else if (purchaseState === 'cancelled') {
      setPurchaseMessage('Report payment was cancelled. No charge was made.');
    }

    // Remove the purchase params so a refresh does not replay the banner.
    router.replace(window.location.pathname, { scroll: false });
  }, [router]);

  useEffect(() => {
    const refreshReportAccess = async () => {
      if (!walletAddress) {
        setReportAccess(emptyReportAccess);
        return;
      }

      setCheckingReportAccess(true);
      try {
        const response = await fetch('/api/report-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress,
            action: 'check',
            sessionId: checkoutSessionId || undefined,
          }),
        });
        const data = await response.json();
        if (response.ok && data.success) {
          setReportAccess({
            ...emptyReportAccess,
            ...data.availableReports,
          });
        }
      } catch (error) {
        console.error('Failed to check report access:', error);
      } finally {
        setCheckingReportAccess(false);
      }
    };

    refreshReportAccess();
  }, [walletAddress, purchaseMessage, checkoutSessionId]);

  const hasPremiumAccess = hasActiveSubscription || hasPromoAccess;
  const hasResults = savedResults.length > 0;

  const hasReportAccess = (reportType: PaidReportType) =>
    hasPremiumAccess || hasValidPromoAccess() || reportAccess[reportType] > 0;

  const requireReportAccess = (reportType: PaidReportType) => {
    if (!hasReportAccess(reportType)) {
      router.push('/subscribe');
      return false;
    }
    return true;
  };

  const handleBuyReportRun = async (reportType: PaidReportType) => {
    if (!isAuthenticated || !walletAddress) {
      openAuthModal();
      return;
    }

    setPurchasingReportType(reportType);
    try {
      const response = await fetch('/api/stripe/create-report-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, reportType }),
      });
      const data = await response.json();
      if (!response.ok || !data.checkoutUrl) {
        throw new Error(data.error || 'Could not start checkout');
      }
      window.location.href = data.checkoutUrl;
    } catch (error) {
      console.error('Failed to create report checkout:', error);
      alert(error instanceof Error ? error.message : 'Could not start checkout');
      setPurchasingReportType(null);
    }
  };

  const consumeReportPass = async (reportType: PaidReportType) => {
    if (hasPremiumAccess || hasValidPromoAccess()) return true;

    if (!walletAddress || reportAccess[reportType] <= 0) {
      return false;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      throw new Error('Please sign in again to use your report pass.');
    }

    const response = await fetch('/api/report-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        walletAddress,
        reportType,
        action: 'consume',
        sessionId: checkoutSessionId || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Could not use report pass');
    }

    setReportAccess(prev => ({
      ...prev,
      [reportType]: Math.max(0, prev[reportType] - 1),
    }));

    return true;
  };

  const handleGenerateReport = () => {
    if (!hasResults || !requireReportAccess('overview')) return;
    setShowOverviewReportModal(true);
  };

  const handleGenerateHealthReport = () => {
    if (!hasResults) return;
    setShowHealthReportModal(true);
  };

  const handleGenerateHealthspanReport = () => {
    if (!hasResults || !requireReportAccess('healthspan')) return;
    setShowHealthspanReportModal(true);
  };

  const handleGenerateTopTraitsReport = () => {
    if (!hasResults || !requireReportAccess('top_traits')) return;
    setShowTopTraitsReportModal(true);
  };

  const renderPaidReportActions = (reportType: PaidReportType, onGenerate: () => void, generateLabel: string) => {
    const hasPass = reportAccess[reportType] > 0;

    return (
      <div className="overview-report-actions">
        <button
          className="primary-button"
          onClick={onGenerate}
          disabled={!hasResults || (!hasPremiumAccess && checkingReportAccess)}
        >
          {!hasResults
            ? 'Load Results First'
            : hasPremiumAccess || hasPass
              ? generateLabel
              : 'Subscribe to Generate'}
        </button>
        {!hasPremiumAccess && !hasPass && (
          <button
            className="secondary-button"
            onClick={() => handleBuyReportRun(reportType)}
            disabled={!hasResults || purchasingReportType !== null}
            style={{ marginTop: '0.5rem' }}
          >
            {purchasingReportType === reportType ? 'Opening Checkout...' : 'Run Once for $4.99'}
          </button>
        )}
        {!hasPremiumAccess && hasPass && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            One paid run available
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page">
        <PremiumFeatureHeader
          featureName="Analyze"
          description="Health Insights is free. Premium reports can be run once for $4.99 or unlocked with a subscription."
          gateTitle="Some reports require a subscription"
          gateDescription="$4.99/month for unlimited premium reports, or run one report once for $4.99."
        />
        <div style={{ textAlign: "right", padding: "0 1rem" }}>
          <button className="tour-help-button" type="button" onClick={() => setTourOpen(true)} title="Show tour" aria-label="Show tour">?</button>
        </div>
        <PremiumPaywall>{null}</PremiumPaywall>

        {purchaseMessage && (
          <div className="subscribe-notice" style={{ margin: '0 1rem 1rem' }}>
            {purchaseMessage}
          </div>
        )}

        <section className="premium-section premium-feature-section">
          <div className="premium-feature-intro">
            <div>
              <div className="premium-feature-title-row">
                <h2>Overview Report</h2>
              </div>
              <p>
                Turn your saved analysis results into a concise AI-generated
                report covering patterns, themes, and suggested next steps.
              </p>
            </div>
          </div>

          {/* Health Insights Report */}
          <div className="overview-report-panel">
            <div className="overview-report-icon" style={{ fontSize: '2.5rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
              🧬
            </div>
            <div className="overview-report-copy">
              <h3>
                Health Insights Report
                <span className="experimental-badge" style={{ marginLeft: '0.5rem' }}>New</span>
              </h3>
              <p>
                Anchors to your personal and family health history. Selects the most relevant genetic associations and identifies the biological mechanisms that may be affecting your health. Add conditions in Personalization for best results.
              </p>
            </div>
            <div className="overview-report-actions">
              <button
                className="primary-button"
                onClick={handleGenerateHealthReport}
                disabled={!hasResults}
                data-tour="generate-report-button"
              >
                {!hasResults ? "Load Results First" : "Generate Health Insights"}
              </button>
            </div>
          </div>

          {/* Healthspan Report */}
          <div className="overview-report-panel" style={{ marginTop: '1rem' }}>
            <div className="overview-report-icon" style={{ fontSize: '2.5rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
              📊
            </div>
            <div className="overview-report-copy">
              <h3>
                Healthspan Report
                <span className="experimental-badge" style={{ marginLeft: '0.5rem' }}>New</span>
                <span className="premium-tab-badge" style={{ marginLeft: '0.5rem' }}>Premium</span>
              </h3>
              <p>
                Organizes your associations by healthspan domain: cardiovascular, metabolic, neurological, immune, musculoskeletal, and cancer susceptibility. Synthesizes patterns within and across domains.
              </p>
            </div>
            {renderPaidReportActions('healthspan', handleGenerateHealthspanReport, 'Generate Healthspan Report')}
          </div>

          {/* Top Traits Report */}
          <div className="overview-report-panel" style={{ marginTop: '1rem' }}>
            <div className="overview-report-icon" style={{ fontSize: '2.5rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56 }}>
              🏆
            </div>
            <div className="overview-report-copy">
              <h3>
                Top Traits Report
                <span className="experimental-badge" style={{ marginLeft: '0.5rem' }}>New</span>
                <span className="premium-tab-badge" style={{ marginLeft: '0.5rem' }}>Premium</span>
              </h3>
              <p>
                Takes your 100 strongest genetic associations by effect size and synthesizes what they reveal about your biology. Good starting point if you have not added health history yet.
              </p>
            </div>
            {renderPaidReportActions('top_traits', handleGenerateTopTraitsReport, 'Generate Top Traits Report')}
          </div>

          {/* Comprehensive Overview Report (experimental, at bottom) */}
          <div className="overview-report-panel" style={{ marginTop: '2rem', opacity: 0.85 }}>
            <div className="overview-report-icon">
              <OverviewReportIcon size={56} />
            </div>
            <div className="overview-report-copy">
              <h3>
                Comprehensive Overview Report
                <span className="experimental-badge" style={{ marginLeft: '0.5rem' }}>Experimental</span>
                <span className="premium-tab-badge" style={{ marginLeft: '0.5rem' }}>Premium</span>
              </h3>
              <p>
                Analyzes all your saved genetic results across categories: health, lifestyle, appearance, personality, and more. Works best after running broad analysis. Currently under development.
              </p>
            </div>
            {renderPaidReportActions('overview', handleGenerateReport, 'Generate Overview Report')}
          </div>
        </section>
      </main>
      <Footer />
      <OverviewReportModal
        isOpen={showOverviewReportModal}
        onClose={() => setShowOverviewReportModal(false)}
        hasPremiumAccess={hasPremiumAccess}
        hasOneTimeAccess={reportAccess.overview > 0}
        onConsumeOneTimeAccess={() => consumeReportPass('overview')}
      />
      <HealthReportModal
        isOpen={showHealthReportModal}
        onClose={() => setShowHealthReportModal(false)}
      />
      <HealthspanReportModal
        isOpen={showHealthspanReportModal}
        onClose={() => setShowHealthspanReportModal(false)}
        hasPremiumAccess={hasPremiumAccess}
        onConsumeOneTimeAccess={() => consumeReportPass('healthspan')}
      />
      <TopTraitsReportModal
        isOpen={showTopTraitsReportModal}
        onClose={() => setShowTopTraitsReportModal(false)}
        hasPremiumAccess={hasPremiumAccess}
        onConsumeOneTimeAccess={() => consumeReportPass('top_traits')}
      />
      <GuidedTour tour={overviewReportTour} isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
