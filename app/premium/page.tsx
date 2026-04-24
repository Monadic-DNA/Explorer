"use client";

import { useEffect, useMemo, useState } from "react";
import type { Metadata } from "next";
import { useGenotype } from "../components/UserDataUpload";
import { useResults } from "../components/ResultsContext";
import { AuthButton, useAuth } from "../components/AuthProvider";
import { RunAllIcon, LLMChatIcon, OverviewReportIcon } from "../components/Icons";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import DisclaimerModal from "../components/DisclaimerModal";
import RunAllModal from "../components/RunAllModal";
import LLMChatInline from "../components/LLMChatInline";
import OverviewReportModal from "../components/OverviewReportModal";
import { PremiumPaywall } from "../components/PremiumPaywall";
import { hasValidPromoAccess, clearPromoAccess } from "@/lib/promo-access";

// Note: Can't export metadata from client component
// Metadata is handled in layout or via generateMetadata

function PremiumPage() {
  const { genotypeData, isUploaded } = useGenotype();
  const { addResultsBatch, hasResult } = useResults();
  const resultsContext = useResults();
  const { isAuthenticated, hasActiveSubscription, subscriptionData, checkingSubscription, user, initializeDynamic, isDynamicInitialized, refreshSubscription, openAuthModal } = useAuth();

  // Track client-side mounting
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Premium features overview collapsed state
  const [featuresOverviewCollapsed, setFeaturesOverviewCollapsed] = useState(false);

  const [showRunAllDisclaimer, setShowRunAllDisclaimer] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [showRunAllModal, setShowRunAllModal] = useState(false);
  const [showOverviewReportModal, setShowOverviewReportModal] = useState(false);
  const [showSubscriptionMenu, setShowSubscriptionMenu] = useState(false);
  const [runAllStatus, setRunAllStatus] = useState<{
    phase: 'fetching' | 'downloading' | 'decompressing' | 'parsing' | 'storing' | 'analyzing' | 'embeddings' | 'complete' | 'error';
    fetchedBatches: number;
    totalStudiesFetched: number;
    totalInDatabase: number;
    matchingStudies: number;
    processedCount: number;
    totalToProcess: number;
    matchCount: number;
    startTime?: number;
    elapsedSeconds?: number;
    etaSeconds?: number;
    errorMessage?: string;
  }>({
    phase: 'fetching',
    fetchedBatches: 0,
    totalStudiesFetched: 0,
    totalInDatabase: 0,
    matchingStudies: 0,
    processedCount: 0,
    totalToProcess: 0,
    matchCount: 0,
  });

  // Initialize Dynamic.xyz on mount
  useEffect(() => {
    if (!isDynamicInitialized) {
      console.log('[PremiumPage] Initializing Dynamic...');
      initializeDynamic();
    }
  }, [isDynamicInitialized, initializeDynamic]);

  const handleRunAll = () => {
    if (!genotypeData || genotypeData.size === 0) {
      alert("No SNPs found in your genetic data");
      return;
    }

    setShowRunAllDisclaimer(true);
  };

  const handleRunAllDisclaimerAccept = async () => {
    setShowRunAllDisclaimer(false);

    // Check if we need to download the catalog first
    const { gwasDB } = await import('@/lib/gwas-db');
    const metadata = await gwasDB.getMetadata();

    if (!metadata) {
      const confirmDownload = window.confirm(
        `First-time setup: Download ~54MB GWAS Catalog data?\n\n` +
        `This will be cached locally for instant future analysis.\n` +
        `Estimated storage: ~500MB after decompression.\n\n` +
        `Continue?`
      );
      if (!confirmDownload) return;
    } else {
      const confirmRun = window.confirm(
        `Analyze all ${metadata.totalStudies.toLocaleString()} studies where you have matching SNPs?\n\n` +
        `Using cached data from ${new Date(metadata.downloadDate).toLocaleDateString()}\n\n` +
        `Continue?`
      );
      if (!confirmRun) return;
    }

    // Initialize and show modal
    setIsRunningAll(true);
    setShowRunAllModal(true);
    const startTime = Date.now();
    setRunAllStatus({
      phase: 'fetching',
      fetchedBatches: 0,
      totalStudiesFetched: 0,
      totalInDatabase: 0,
      matchingStudies: 0,
      processedCount: 0,
      totalToProcess: 0,
      matchCount: 0,
      startTime,
    });

    try {
      // Check if genotype data is loaded
      if (!genotypeData) {
        throw new Error('No genotype data loaded. Please upload your genetic data first.');
      }

      // Use IndexedDB-based implementation
      const { runAllAnalysisIndexed } = await import('@/lib/run-all-indexed');

      const results = await runAllAnalysisIndexed(
        genotypeData,
        (progress) => {
          setRunAllStatus(prev => ({
            ...prev,
            phase: progress.phase,
            totalStudiesFetched: progress.loaded,
            totalInDatabase: progress.total,
            matchingStudies: progress.matchingStudies,
            matchCount: progress.matchCount,
            elapsedSeconds: progress.elapsedSeconds,
            fetchedBatches: 0,
            processedCount: progress.matchingStudies,
            totalToProcess: progress.matchingStudies,
          }));
        },
        hasResult
      );

      // Add all results in one efficient batch operation
      console.log(`Adding ${results.length} results to the results manager...`);
      const startAdd = Date.now();
      await addResultsBatch(results);
      const addTime = Date.now() - startAdd;
      console.log(`Finished adding ${results.length} results in ${addTime}ms`);

      // Notify MenuBar that cache has been updated
      window.dispatchEvent(new CustomEvent('cacheUpdated'));
    } catch (error) {
      console.error('Run All failed:', error);
      setRunAllStatus(prev => ({
        ...prev,
        phase: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }));
    } finally {
      setIsRunningAll(false);
    }
  };

  return (
    <div className="app-container">
        <MenuBar />
        <main className="page">
          {/* Show loading state while Dynamic initializes */}
          {!isDynamicInitialized ? (
            <section className="premium-compact-header">
              <div className="premium-header-content">
                <div className="auth-prompt-inline">
                  <span>Loading premium features...</span>
                </div>
              </div>
            </section>
          ) : (
            <>
              {/* Account & Subscription Compact Header */}
              <section className="premium-compact-header">
                <div className="premium-header-content">
                  {!isAuthenticated ? (
                    <div className="auth-prompt-inline">
                      <span title={"We do not store user information on our servers\nWe use dynamic.xyz for sign in\nLogin is needed to track subscription status"}>
                        Sign in to access premium features →
                      </span>
                    </div>
                  ) : !hasActiveSubscription ? (
                    <div className="subscription-prompt-inline">
                      <div className="subscription-message">
                        <strong>Premium subscription required</strong>
                        <span>Subscribe for $4.99/month to access Run All Analysis, LLM Chat, and Overview Report.</span>
                      </div>
                      <button
                        onClick={() => {
                          const event = new CustomEvent('openPaymentModal');
                          window.dispatchEvent(event);
                        }}
                        className="subscribe-button"
                      >
                        Subscribe
                      </button>
                    </div>
                  ) : subscriptionData ? (
                    <div className="subscription-active-inline">
                      <span>✓ Premium Active</span>
                    </div>
                  ) : null}
                  <div className="premium-wallet-section">
                    <AuthButton />
                  </div>
                  {subscriptionData && (
                    <div className="subscription-menu-container">
                      <button
                        onClick={() => setShowSubscriptionMenu(!showSubscriptionMenu)}
                        className="subscription-menu-button"
                        title="Subscription options"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2"/>
                          <circle cx="12" cy="12" r="2"/>
                          <circle cx="12" cy="19" r="2"/>
                        </svg>
                      </button>
                      {showSubscriptionMenu && (
                        <>
                          <div
                            className="subscription-menu-backdrop"
                            onClick={() => setShowSubscriptionMenu(false)}
                          />
                          <div className="subscription-menu-dropdown">
                            <div className="subscription-menu-header">
                              <div className="subscription-menu-info">
                                <strong>Subscription Details</strong>
                                {subscriptionData.daysRemaining > 0 && (
                                  <span>{subscriptionData.daysRemaining} days remaining in current cycle</span>
                                )}
                                {subscriptionData.expiresAt && (
                                  <span className="expires-date">Renews {new Date(subscriptionData.expiresAt).toLocaleDateString()}</span>
                                )}
                              </div>
                            </div>
                            <div className="subscription-menu-divider"></div>
                            <button
                              onClick={async () => {
                                setShowSubscriptionMenu(false);
                                try {
                                  await refreshSubscription(true);
                                  alert('✓ Subscription status refreshed!');
                                } catch (error) {
                                  console.error('Failed to refresh subscription:', error);
                                  alert('Failed to refresh subscription. Please try again.');
                                }
                              }}
                              className="subscription-menu-item"
                              disabled={checkingSubscription}
                            >
                              {checkingSubscription ? '⏳ Checking...' : '🔄 Refresh Subscription'}
                            </button>
                            <button
                              onClick={async () => {
                                setShowSubscriptionMenu(false);
                                if (!confirm('Are you sure you want to cancel your subscription? It will remain active until the end of your billing period.')) {
                                  return;
                                }
                                try {
                                  const walletAddress = user?.verifiedCredentials?.[0]?.address;
                                  if (!walletAddress) {
                                    alert('Could not find wallet address');
                                    return;
                                  }
                                  const response = await fetch('/api/stripe/cancel-subscription', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ walletAddress }),
                                  });
                                  const data = await response.json();
                                  if (response.ok) {
                                    alert(data.message || 'Subscription cancelled successfully');
                                    window.location.reload();
                                  } else {
                                    alert(data.error || 'Failed to cancel subscription');
                                  }
                                } catch (error) {
                                  alert('Error cancelling subscription');
                                  console.error(error);
                                }
                              }}
                              className="subscription-menu-item cancel"
                            >
                              Cancel Subscription
                            </button>
                            {hasValidPromoAccess() && (
                              <button
                                onClick={() => {
                                  setShowSubscriptionMenu(false);
                                  if (!confirm('Are you sure you want to remove your promo code? You will lose premium access immediately.')) {
                                    return;
                                  }
                                  clearPromoAccess();
                                  alert('✓ Promo code removed');
                                  window.location.reload();
                                }}
                                className="subscription-menu-item cancel"
                              >
                                Remove Promo Code
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </section>
              <PremiumPaywall>{null}</PremiumPaywall>
              <section className="premium-section">
                {/* Feature Overview Cards - Compact 3-column with collapse button */}
                <div className="premium-features-header">
                  <button
                    className="collapse-button"
                    onClick={() => setFeaturesOverviewCollapsed(!featuresOverviewCollapsed)}
                    title={featuresOverviewCollapsed ? "Show features" : "Hide features"}
                  >
                    {featuresOverviewCollapsed ? "Show Features ↓" : "Hide Features ↑"}
                  </button>
                </div>

                {!featuresOverviewCollapsed && (
                  <div className="premium-features-overview">
                    {/* Run All Card - First */}
                    <div className="feature-overview-card">
                      <div className="feature-icon">
                        <RunAllIcon size={48} />
                      </div>
                      <h3>Run All</h3>
                      <p>Run your data through all million+ traits</p>
                      <button
                        className="feature-quick-action"
                        onClick={() => {
                          if (!isAuthenticated) {
                            openAuthModal();
                          } else if (!hasActiveSubscription) {
                            const event = new CustomEvent('openPaymentModal');
                            window.dispatchEvent(event);
                          } else {
                            handleRunAll();
                          }
                        }}
                        disabled={isRunningAll || !mounted || (isAuthenticated && hasActiveSubscription && !isUploaded)}
                      >
                        {isRunningAll ? 'Running...' :
                         !isAuthenticated ? 'Sign In' :
                         !hasActiveSubscription ? 'Subscribe' :
                         !isUploaded ? 'Upload DNA File' :
                         resultsContext.savedResults.length > 0 ? 'Run Again' : 'Start'}
                      </button>
                    </div>

                    {/* LLM Chat Card - Primary */}
                    <div className="feature-overview-card primary">
                      <div className="feature-icon">
                        <LLMChatIcon size={48} />
                      </div>
                      <h3>LLM Chat</h3>
                      <p>Ask a private LLM questions about your genetic data</p>
                    </div>

                    {/* Overview Report Card */}
                    <div className="feature-overview-card">
                      <div className="feature-icon">
                        <OverviewReportIcon size={48} />
                      </div>
                      <h3>Overview Report <span style={{color: '#ff9800', fontSize: '0.8em'}}>(Experimental)</span></h3>
                      <p>Have an LLM analyze all your traits</p>
                      <button
                        className="feature-quick-action"
                        onClick={() => {
                          if (!isAuthenticated) {
                            openAuthModal();
                          } else if (!hasActiveSubscription) {
                            const event = new CustomEvent('openPaymentModal');
                            window.dispatchEvent(event);
                          } else {
                            setShowOverviewReportModal(true);
                          }
                        }}
                        disabled={!mounted || (isAuthenticated && hasActiveSubscription && resultsContext.savedResults.length < 1000)}
                      >
                        {!isAuthenticated ? 'Sign In' :
                         !hasActiveSubscription ? 'Subscribe' :
                         resultsContext.savedResults.length < 1000 ? 'Run Analysis First' : 'Generate Report'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Separator */}
                <div className="premium-separator"></div>

                {/* LLM Chat - Full Interface */}
                <LLMChatInline />
              </section>
            </>
          )}
        </main>
        <Footer />
        <DisclaimerModal
          isOpen={showRunAllDisclaimer}
          onClose={() => setShowRunAllDisclaimer(false)}
          type="initial"
          onAccept={handleRunAllDisclaimerAccept}
        />
        <RunAllModal
          isOpen={showRunAllModal}
          onClose={() => setShowRunAllModal(false)}
          status={runAllStatus}
        />
        <OverviewReportModal
          isOpen={showOverviewReportModal}
          onClose={() => setShowOverviewReportModal(false)}
        />
    </div>
  );
}

export default PremiumPage;
