"use client";

import { useState, useEffect } from "react";
import UserDataUpload, { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import CustomizationModal from "./CustomizationModal";
import { FileIcon, SaveIcon, TrashIcon, MessageIcon, ClockIcon } from "./Icons";

type MenuBarProps = {
  onRunAll?: () => void;
  isRunningAll?: boolean;
  runAllProgress?: { current: number; total: number };
};

export default function MenuBar({ onRunAll, isRunningAll, runAllProgress }: MenuBarProps) {
  const { isUploaded, genotypeData, fileHash } = useGenotype();
  const { savedResults, saveToFile, loadFromFile, clearResults } = useResults();
  const { status: customizationStatus } = useCustomization();
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [cacheInfo, setCacheInfo] = useState<{ studies: number; sizeMB: number } | null>(null);

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

  const getCustomizationIcon = () => {
    switch (customizationStatus) {
      case 'not-set':
        return '⚙️';
      case 'locked':
        return '🔒';
      case 'unlocked':
        return '🔓';
    }
  };

  const getCustomizationTooltip = () => {
    switch (customizationStatus) {
      case 'not-set':
        return 'Personalize AI analysis with your personal information';
      case 'locked':
        return 'Personalization is locked - click to unlock';
      case 'unlocked':
        return 'Personalization is unlocked - click to edit or lock';
    }
  };

  return (
    <>
      <CustomizationModal
        isOpen={showCustomizationModal}
        onClose={() => setShowCustomizationModal(false)}
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
        <div className="genotype-section">
          {isUploaded && genotypeData && (
            <span className="stat-item">
              {genotypeData.size.toLocaleString()} variants loaded
            </span>
          )}
          <UserDataUpload />
        </div>

        {isUploaded && (
          <>
            <div className="menu-separator" />
            {onRunAll && (
              <button
                className="control-button run-all"
                onClick={onRunAll}
                disabled={isRunningAll}
                title={
                  isRunningAll && runAllProgress
                    ? `Analyzing study ${runAllProgress.current.toLocaleString()} of ${runAllProgress.total.toLocaleString()}`
                    : "Analyze all studies in database where you have matching SNPs"
                }
              >
                {isRunningAll && runAllProgress ? (
                  <>⏳ Running...</>
                ) : (
                  <>▶ Run All</>
                )}
              </button>
            )}
          </>
        )}

        <div className="menu-separator" />
        <div className="results-section menu-group">
          {savedResults.length > 0 && (
            <span className="stat-item">
              {savedResults.length} result{savedResults.length !== 1 ? 's' : ''} cached
            </span>
          )}
          <div className="results-controls">
            <button
              className="control-button load"
              onClick={handleLoadFromFile}
              disabled={isLoadingFile}
              title="Load results from a file"
            >
              {isLoadingFile ? (
                <>
                  <ClockIcon size={14} /> Loading...
                </>
              ) : (
                <>
                  <FileIcon size={14} /> Load
                </>
              )}
            </button>
            {savedResults.length > 0 && (
              <>
                <button
                  className="control-button save"
                  onClick={() => saveToFile(genotypeData?.size, fileHash || undefined)}
                  title="Export your results to a TSV file"
                >
                  <SaveIcon size={14} /> Export
                </button>
                <button
                  className="control-button clear"
                  onClick={clearResults}
                  title="Clear all saved results"
                >
                  <TrashIcon size={14} /> Clear
                </button>
              </>
            )}
          </div>
        </div>

        <div className="menu-separator" />

        <div className="utility-section menu-group">
          <button
            className={`control-button personalize-button ${customizationStatus}`}
            onClick={() => setShowCustomizationModal(true)}
            title={getCustomizationTooltip()}
          >
            {getCustomizationIcon()} Personalize
          </button>
        </div>

        <div className="menu-separator" />

        <div className="utility-section menu-group">
          {cacheInfo && (
            <>
              <span className="stat-item">
                {cacheInfo.studies.toLocaleString()} studies cached ({cacheInfo.sizeMB} MB)
              </span>
              <button
                className="control-button"
                onClick={async () => {
                  const confirmed = window.confirm(
                    `Clear cached GWAS Catalog data?\n\n` +
                    `${cacheInfo.studies.toLocaleString()} studies (${cacheInfo.sizeMB} MB)\n\n` +
                    `Data will be re-downloaded on next Run All.`
                  );
                  if (confirmed) {
                    try {
                      // Show loading state
                      const button = document.activeElement as HTMLButtonElement;
                      const originalText = button?.innerHTML;
                      if (button) {
                        button.disabled = true;
                        button.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; margin-right: 6px;"></div> Clearing...';
                      }

                      const { gwasDB } = await import('@/lib/gwas-db');
                      await gwasDB.clearDatabase();
                      setCacheInfo(null);

                      // Restore button and show success
                      if (button && originalText) {
                        button.disabled = false;
                        button.innerHTML = originalText;
                      }
                      alert('✓ Cache cleared successfully!');
                    } catch (error) {
                      console.error('Failed to clear cache:', error);
                      alert('Failed to clear cache. Please try again.');
                    }
                  }
                }}
                title="Clear locally cached GWAS catalog data"
              >
                <TrashIcon size={14} /> Clear Cache
              </button>
            </>
          )}

          <a
            href="https://recherche.discourse.group/c/public/monadic-dna/30"
            target="_blank"
            rel="noopener noreferrer"
            className="feedback-button"
            title="Join fellow explorers—share your feedback on our forum"
          >
            <MessageIcon size={14} /> Feedback
          </a>

          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
