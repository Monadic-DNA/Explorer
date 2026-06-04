"use client";

import { useState, useEffect, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import UserDataUpload, { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import CustomizationModal from "./CustomizationModal";
import LLMConfigModal from "./LLMConfigModal";
import { MyDataDropdown, ResultsDropdown, CacheDropdown, HelpDropdown } from "./MenuDropdowns";
import { DNAIcon, FolderIcon, MicroscopeIcon, SparklesIcon, CacheIcon, HelpCircleIcon, SunIcon, MoonIcon, RunAllIcon } from "./Icons";
import GuidedTour, { hasCompletedTour } from "./GuidedTour";
import { menuBarTour } from "./tours/tourContent";
import { getLLMConfig, getProviderDisplayName } from "@/lib/llm-config";
import NillionModal from "./NillionModal";
import DisclaimerModal from "./DisclaimerModal";
import RunAllModal from "./RunAllModal";
import {
  trackGetStartedClicked,
  trackRunAllCompleted,
  trackRunAllFailed,
  trackRunAllStarted,
} from "@/lib/analytics";

type RunAllStatus = {
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
};

export default function MenuBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isUploaded, genotypeData, fileHash } = useGenotype();
  const { savedResults, saveToFile, loadFromFile, clearResults, addResultsBatch, hasResult } = useResults();
  const { status: customizationStatus } = useCustomization();
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [showLLMConfigModal, setShowLLMConfigModal] = useState(false);
  const [showMyDataDropdown, setShowMyDataDropdown] = useState(false);
  const [showResultsDropdown, setShowResultsDropdown] = useState(false);
  const [showCacheDropdown, setShowCacheDropdown] = useState(false);
  const [showHelpDropdown, setShowHelpDropdown] = useState(false);
  const [showNillionModal, setShowNillionModal] = useState(false);
  const [showRunAllDisclaimer, setShowRunAllDisclaimer] = useState(false);
  const [showRunAllModal, setShowRunAllModal] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [runAllStatus, setRunAllStatus] = useState<RunAllStatus>({
    phase: 'fetching',
    fetchedBatches: 0,
    totalStudiesFetched: 0,
    totalInDatabase: 0,
    matchingStudies: 0,
    processedCount: 0,
    totalToProcess: 0,
    matchCount: 0,
  });
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
  const [menuTourOpen, setMenuTourOpen] = useState(false);

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

  useEffect(() => {
    const handleOpenDNAUpload = () => {
      setShowMyDataDropdown(true);

      // Wait for the dropdown and uploader to mount, then open the file picker.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('openDNAUploadPicker'));
      }, 60);
    };

    window.addEventListener('openDNAUpload', handleOpenDNAUpload);

    return () => {
      window.removeEventListener('openDNAUpload', handleOpenDNAUpload);
    };
  }, []);

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

  const handleRunAll = () => {
    window.dispatchEvent(new Event("showMobileCompatibilityNotice"));

    if (isRunningAll) {
      setShowRunAllModal(true);
      return;
    }

    if (!genotypeData || genotypeData.size === 0) {
      setShowMyDataDropdown(true);
      trackRunAllFailed("menu", "no_genotype_data");
      alert("Upload your DNA file before running all traits.");
      return;
    }

    setShowRunAllDisclaimer(true);
  };

  const handleRunAllDisclaimerAccept = async () => {
    setShowRunAllDisclaimer(false);

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

    trackRunAllStarted(metadata?.totalStudies || 0);

    try {
      if (!genotypeData) {
        throw new Error('No genotype data loaded. Please upload your genetic data first.');
      }

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

      console.log(`Adding ${results.length} results to the results manager...`);
      const startAdd = Date.now();
      await addResultsBatch(results);
      const addTime = Date.now() - startAdd;
      console.log(`Finished adding ${results.length} results in ${addTime}ms`);
      trackRunAllCompleted(metadata?.totalStudies || 0, results.length, results.length, "menu");

      window.dispatchEvent(new CustomEvent('cacheUpdated'));
    } catch (error) {
      console.error('Run All failed:', error);
      trackRunAllFailed("menu", error instanceof Error ? error.message : "run_all_failed");
      setRunAllStatus(prev => ({
        ...prev,
        phase: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }));
    } finally {
      setIsRunningAll(false);
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

  const getNavLinkStyle = (active: boolean): CSSProperties => ({
    padding: "0.5rem 1rem",
    textDecoration: "none",
    color: active ? "var(--primary-color, #667eea)" : "inherit",
    borderBottom: active ? "2px solid var(--primary-color, #667eea)" : "none",
    fontWeight: active ? 600 : 400
  });

  const isDNAChatActive = pathname === "/dna-chat" || pathname === "/llm-chat";
  const isOverviewReportActive = pathname === "/overview-report";

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
        onRestartOnboarding={() => {
          trackGetStartedClicked("welcome_options");
          if (pathname === "/") {
            window.dispatchEvent(new CustomEvent("openNewUserChoiceModal"));
            return;
          }

          router.push("/?onboarding=1");
        }}
      />
      <NillionModal
        isOpen={showNillionModal}
        onClose={() => setShowNillionModal(false)}
      />
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
      <GuidedTour tour={menuBarTour} isOpen={menuTourOpen} onClose={() => setMenuTourOpen(false)} />
      <div className="menu-bar">
      <div className="menu-left">
        <h1 className="app-title">
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            Monadic DNA Explorer
          </Link>
        </h1>
        <span className="app-subtitle">Explore thousands of genetic traits from the GWAS Catalog, plug in your own DNA</span>

        {/* Page Navigation */}
        <nav className="page-nav" style={{ marginTop: "0.5rem", display: "flex", gap: "1rem" }}>
          <Link
            href="/"
            className={pathname === "/" ? "nav-link active" : "nav-link"}
            style={getNavLinkStyle(pathname === "/")}
          >
            Home
          </Link>
          <Link
            href="/explore"
            className={pathname === "/explore" ? "nav-link active" : "nav-link"}
            style={getNavLinkStyle(pathname === "/explore")}
          >
            Explore
          </Link>
          <Link
            href="/dna-chat"
            className={isDNAChatActive ? "nav-link active" : "nav-link"}
            style={getNavLinkStyle(isDNAChatActive)}
          >
            Chat
          </Link>
          <Link
            href="/overview-report"
            className={isOverviewReportActive ? "nav-link active nav-premium-link" : "nav-link nav-premium-link"}
            style={getNavLinkStyle(isOverviewReportActive)}
          >
            <span className="nav-link-content">
              Analyze
              <span className="nav-premium-badge">Premium</span>
            </span>
          </Link>
          <Link
            href="/browse"
            className={pathname === "/browse" ? "nav-link active" : "nav-link"}
            style={getNavLinkStyle(pathname === "/browse")}
          >
            Browse
          </Link>
        </nav>
      </div>

      <div className="menu-right">
        {/* Icon-based Navigation */}
        <div className="menu-icons">
          <button
            className="menu-icon-button"
            onClick={() => setShowMyDataDropdown(!showMyDataDropdown)}
            title="Upload and manage your genetic data"
            data-tour="my-data-button"
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
            data-tour="results-button"
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
            className={isRunningAll ? "menu-icon-button running" : "menu-icon-button"}
            onClick={handleRunAll}
            title="Analyze your DNA against all matching GWAS traits"
            data-tour="run-all-button"
          >
            <span className="icon">
              <RunAllIcon size={32} />
            </span>
            <span className="label">Run All</span>
            {isRunningAll && (
              <span className="badge">Running</span>
            )}
          </button>

          <button
            className={`menu-icon-button ${customizationStatus}`}
            onClick={() => setShowCustomizationModal(true)}
            title={getCustomizationTooltip()}
            data-tour="personalize-button"
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
            data-tour="llm-config-button"
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
            data-tour="cache-button"
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
            title="Get help and start options"
            data-tour="help-button"
          >
            <span className="icon">
              <HelpCircleIcon size={32} />
            </span>
            <span className="label">Help</span>
          </button>

          {mounted && (
            <button
              className="menu-icon-button"
              onClick={toggleTheme}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              data-tour="theme-button"
            >
              <span className="icon">
                {theme === "dark" ? <SunIcon size={32} /> : <MoonIcon size={32} />}
              </span>
              <span className="label">Theme</span>
            </button>
          )}

        </div>
        <div className="menu-explain-row">
          <button className="menu-explain-link" onClick={() => setMenuTourOpen(true)}>
            Explain these buttons
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
