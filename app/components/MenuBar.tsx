"use client";

import { useState, useEffect } from "react";
import UserDataUpload, { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import CustomizationModal from "./CustomizationModal";
import LLMConfigModal from "./LLMConfigModal";
import { MyDataDropdown, ResultsDropdown, CacheDropdown, HelpDropdown } from "./MenuDropdowns";
import { DNAIcon, FolderIcon, MicroscopeIcon, SparklesIcon, CacheIcon, HelpCircleIcon, SunIcon, MoonIcon, NillionIcon } from "./Icons";
import { getLLMConfig, getProviderDisplayName } from "@/lib/llm-config";
import NillionModal from "./NillionModal";

export default function MenuBar() {
  const { isUploaded, genotypeData, fileHash } = useGenotype();
  const { savedResults, saveToFile, loadFromFile, clearResults } = useResults();
  const { status: customizationStatus } = useCustomization();
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [showLLMConfigModal, setShowLLMConfigModal] = useState(false);
  const [showMyDataDropdown, setShowMyDataDropdown] = useState(false);
  const [showResultsDropdown, setShowResultsDropdown] = useState(false);
  const [showCacheDropdown, setShowCacheDropdown] = useState(false);
  const [showHelpDropdown, setShowHelpDropdown] = useState(false);
  const [showNillionModal, setShowNillionModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Initialize theme from localStorage (lazy initialization to avoid hydration issues)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme') as "light" | "dark" | null;
      return savedTheme || "light";
    }
    return "light";
  });
  const [cacheInfo, setCacheInfo] = useState<{ studies: number; sizeMB: number } | null>(null);
  const [llmProvider, setLlmProvider] = useState<string>('');

  // Extract loadCacheInfo for reusability
  const loadCacheInfo = async () => {
    const { gwasDB } = await import('@/lib/gwas-db');
    const metadata = await gwasDB.getMetadata();
    if (metadata) {
      const size = await gwasDB.getStorageSize();
      setCacheInfo({
        studies: metadata.totalStudies,
        sizeMB: Math.round(size / 1024 / 1024)
      });
    } else {
      setCacheInfo(null);
    }
  };

  useEffect(() => {
    // Mark component as mounted
    setMounted(true);

    // Apply theme on mount
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;

    // Load LLM config
    const config = getLLMConfig();
    setLlmProvider(getProviderDisplayName(config.provider));

    // Load cache info on mount
    loadCacheInfo();

    // Listen for cache updates
    const handleCacheUpdated = () => {
      console.log('[MenuBar] Cache updated event received, refreshing cache info');
      loadCacheInfo();
    };

    // Listen for visibility changes to refresh cache when user returns to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadCacheInfo();
      }
    };

    window.addEventListener('cacheUpdated', handleCacheUpdated);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('cacheUpdated', handleCacheUpdated);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    // Apply theme changes and persist to localStorage
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('theme', theme);
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
        onClose={() => {
          setShowLLMConfigModal(false);
          // Refresh LLM provider after closing modal
          const config = getLLMConfig();
          setLlmProvider(getProviderDisplayName(config.provider));
        }}
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
        onStartTour={() => {
          // Dispatch custom event that page.tsx can listen to
          const event = new CustomEvent('startGuidedTour');
          window.dispatchEvent(event);
        }}
      />
      <NillionModal
        isOpen={showNillionModal}
        onClose={() => setShowNillionModal(false)}
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
            {isUploaded && genotypeData && (
              <span className="badge">{genotypeData.size.toLocaleString()}</span>
            )}
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
            <span className="badge">{llmProvider || 'OpenAI'}</span>
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
            {cacheInfo && (
              <span className="badge">{cacheInfo.studies.toLocaleString()}</span>
            )}
          </button>

          <button
            className="menu-icon-button"
            onClick={() => setShowHelpDropdown(!showHelpDropdown)}
            title="Get help and restart the guided tour"
          >
            <span className="icon">
              <HelpCircleIcon size={32} />
            </span>
            <span className="label">Help</span>
          </button>

          <button
            className="menu-icon-button"
            onClick={() => setShowNillionModal(true)}
            title="x Nillion: Test your crypto degen score"
          >
            <span className="icon">
              <NillionIcon size={32} />
            </span>
            <span className="label">x Nillion</span>
          </button>

          {mounted && (
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
          )}
        </div>
      </div>
    </div>
    </>
  );
}
