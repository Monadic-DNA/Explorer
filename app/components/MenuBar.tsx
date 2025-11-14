"use client";

import { useState, useEffect } from "react";
import UserDataUpload, { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import CustomizationModal from "./CustomizationModal";
import LLMConfigModal from "./LLMConfigModal";
import { MyDataDropdown, ResultsDropdown, CacheDropdown, HelpDropdown } from "./MenuDropdowns";
import { DNAIcon, FolderIcon, MicroscopeIcon, SparklesIcon, CacheIcon, HelpCircleIcon, SunIcon, MoonIcon, CrownIcon } from "./Icons";
import { AuthButton, useAuth } from "./AuthProvider";

export default function MenuBar() {
  const { isUploaded, genotypeData, fileHash } = useGenotype();
  const { savedResults, saveToFile, loadFromFile, clearResults } = useResults();
  const { status: customizationStatus } = useCustomization();
  const { isAuthenticated, hasActiveSubscription, subscriptionData, user } = useAuth();
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [showLLMConfigModal, setShowLLMConfigModal] = useState(false);
  const [showMyDataDropdown, setShowMyDataDropdown] = useState(false);
  const [showResultsDropdown, setShowResultsDropdown] = useState(false);
  const [showCacheDropdown, setShowCacheDropdown] = useState(false);
  const [showHelpDropdown, setShowHelpDropdown] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [cacheInfo, setCacheInfo] = useState<{ studies: number; sizeMB: number } | null>(null);
  const [showSubscriptionMenu, setShowSubscriptionMenu] = useState(false);

  useEffect(() => {
    // Close subscription menu when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.subscription-indicator')) {
        setShowSubscriptionMenu(false);
      }
    };

    if (showSubscriptionMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showSubscriptionMenu]);

  useEffect(() => {
    // Detect system preference on mount
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = isDark ? "dark" : "light";
    setTheme(initialTheme);

    // Apply initial theme
    document.documentElement.setAttribute("data-theme", initialTheme);
    document.documentElement.style.colorScheme = initialTheme;

    // Load cache info
    const loadCacheInfo = async () => {
      const { gwasDB } = await import('@/lib/gwas-db');
      const metadata = await gwasDB.getMetadata();
      if (metadata) {
        const size = await gwasDB.getStorageSize();
        setCacheInfo({
          studies: metadata.totalStudies,
          sizeMB: Math.round(size / 1024 / 1024)
        });
      }
    };
    loadCacheInfo();
  }, []);

  useEffect(() => {
    // Apply theme changes
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleLoadFromFile = async () => {
    setIsLoadingFile(true);
    try {
      // Allow loading results even without DNA file loaded
      // fileHash will be null/undefined if no DNA file is loaded
      await loadFromFile(fileHash || null);
    } catch (error) {
      alert('Failed to load results file: ' + (error as Error).message);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const getCustomizationTooltip = () => {
    switch (customizationStatus) {
      case 'not-set':
        return 'Personalize LLM analysis with your personal information';
      case 'locked':
        return 'Personalization is locked - click to unlock';
      case 'unlocked':
        return 'Personalization is unlocked - click to edit or lock';
    }
  };

  const handleClearCache = async () => {
    if (!cacheInfo) return;

    const confirmed = window.confirm(
      `Clear cached GWAS Catalog data?\n\n` +
      `${cacheInfo.studies.toLocaleString()} studies (${cacheInfo.sizeMB} MB)\n\n` +
      `Data will be re-downloaded on next Run All.`
    );
    if (confirmed) {
      try {
        const { gwasDB } = await import('@/lib/gwas-db');
        await gwasDB.clearDatabase();
        setCacheInfo(null);
        alert('✓ Cache cleared successfully!');
      } catch {
        alert('Failed to clear cache. Please try again.');
      }
    }
  };

  return (
    <>
      <CustomizationModal
        isOpen={showCustomizationModal}
        onClose={() => setShowCustomizationModal(false)}
      />
      <LLMConfigModal
        isOpen={showLLMConfigModal}
        onClose={() => setShowLLMConfigModal(false)}
        onSave={() => {}}
      />
      <MyDataDropdown
        isOpen={showMyDataDropdown}
        onClose={() => setShowMyDataDropdown(false)}
        isUploaded={isUploaded}
        genotypeData={genotypeData}
        UserDataUploadComponent={UserDataUpload}
      />
      <ResultsDropdown
        isOpen={showResultsDropdown}
        onClose={() => setShowResultsDropdown(false)}
        savedResults={savedResults}
        onLoadFromFile={handleLoadFromFile}
        onSaveToFile={() => saveToFile(genotypeData?.size, fileHash || undefined)}
        onClearResults={clearResults}
        isLoadingFile={isLoadingFile}
      />
      <CacheDropdown
        isOpen={showCacheDropdown}
        onClose={() => setShowCacheDropdown(false)}
        cacheInfo={cacheInfo}
        onClearCache={handleClearCache}
      />
      <HelpDropdown
        isOpen={showHelpDropdown}
        onClose={() => setShowHelpDropdown(false)}
      />
    <div className="menu-bar">
      <div className="menu-left">
        <h1 className="app-title">
          <a
            href="https://monadicdna.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="monadic-link"
          >
            Monadic DNA
          </a>{" "}
          Explorer
        </h1>
        <span className="app-subtitle">Explore thousands of genetic traits from the GWAS Catalog, plug in your own DNA</span>
      </div>

      <div className="menu-right">
        {/* Icon-based Navigation */}
        <div className="menu-icons">
          <button
            className="menu-icon-button"
            onClick={() => setShowMyDataDropdown(!showMyDataDropdown)}
            title="Upload and manage your genetic data"
          >
            <span className="icon">
              <DNAIcon size={32} />
            </span>
            <span className="label">My Data</span>
          </button>

          <button
            className="menu-icon-button"
            onClick={() => setShowResultsDropdown(!showResultsDropdown)}
            title="Load, export, and manage results"
          >
            <span className="icon">
              <FolderIcon size={32} />
            </span>
            <span className="label">Results</span>
            {savedResults.length > 0 && (
              <span className="badge">{savedResults.length}</span>
            )}
          </button>

          <button
            className={`menu-icon-button ${customizationStatus}`}
            onClick={() => setShowCustomizationModal(true)}
            title={getCustomizationTooltip()}
          >
            <span className="icon">
              <MicroscopeIcon size={32} />
            </span>
            <span className="label">Personalize</span>
          </button>

          <button
            className="menu-icon-button"
            onClick={() => setShowLLMConfigModal(true)}
            title="Configure LLM provider and model"
          >
            <span className="icon">
              <SparklesIcon size={32} />
            </span>
            <span className="label">LLM</span>
          </button>

          <button
            className="menu-icon-button"
            onClick={() => setShowCacheDropdown(!showCacheDropdown)}
            title="View and manage cached GWAS data"
          >
            <span className="icon">
              <CacheIcon size={32} />
            </span>
            <span className="label">Cache</span>
          </button>

          <button
            className="menu-icon-button"
            onClick={() => setShowHelpDropdown(!showHelpDropdown)}
            title="Help and feedback"
          >
            <span className="icon">
              <HelpCircleIcon size={32} />
            </span>
            <span className="label">Help</span>
          </button>

          <button
            className="menu-icon-button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="icon">
              {theme === "dark" ? <SunIcon size={32} /> : <MoonIcon size={32} />}
            </span>
            <span className="label">Theme</span>
          </button>
        </div>

        <div className="menu-separator" />

        {/* Subscription/Plan Icon Button */}
        <button
          className={`menu-icon-button ${hasActiveSubscription ? 'subscribed' : 'not-subscribed'}`}
          onClick={() => setShowSubscriptionMenu(!showSubscriptionMenu)}
          title={hasActiveSubscription ? `Premium subscription (${subscriptionData?.daysRemaining || 0} days remaining)` : 'Subscribe to Premium'}
        >
          <span className="icon">
            <CrownIcon size={32} />
          </span>
          <span className="label">Plan</span>
          {hasActiveSubscription && subscriptionData && (
            <span className="badge">{subscriptionData.daysRemaining}d</span>
          )}
        </button>

        {showSubscriptionMenu && hasActiveSubscription && subscriptionData && (
          <div className="subscription-dropdown" style={{
            position: 'fixed',
            top: '5rem',
            right: '2rem',
            background: 'var(--secondary-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.5rem',
            minWidth: '300px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.3)',
            zIndex: 1000
          }}>
            <div className="subscription-info">
              <p><strong>Premium Subscription</strong></p>
              <p>Expires: {subscriptionData.expiresAt ? new Date(subscriptionData.expiresAt).toLocaleDateString() : 'N/A'}</p>
              <p>Days remaining: {subscriptionData.daysRemaining}</p>
            </div>
            <button
              className="control-button cancel-subscription"
              style={{ marginTop: '1rem', width: '100%' }}
              onClick={async () => {
                if (confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your current billing period.')) {
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
                    const result = await response.json();
                    if (result.success) {
                      alert('Subscription cancelled successfully. You will retain access until ' + new Date(subscriptionData.expiresAt!).toLocaleDateString());
                      window.location.reload();
                    } else {
                      alert('Failed to cancel subscription: ' + (result.error || 'Unknown error'));
                    }
                  } catch {
                    alert('Failed to cancel subscription. Please try again.');
                  }
                }
              }}
              title="Cancel Stripe subscription (only available for card payments)"
            >
              Cancel Subscription
            </button>
          </div>
        )}

        <div className="menu-separator" />

        <div className="auth-section menu-group">
          <AuthButton />
        </div>
      </div>
    </div>
    </>
  );
}
