"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { GenotypeProvider, useGenotype } from "./components/UserDataUpload";
import { ResultsProvider, useResults } from "./components/ResultsContext";
import { CustomizationProvider } from "./components/CustomizationContext";
import StudyResultReveal from "./components/StudyResultReveal";
import MenuBar from "./components/MenuBar";
import VariantChips from "./components/VariantChips";
import Footer from "./components/Footer";
import DisclaimerModal from "./components/DisclaimerModal";
import TermsAcceptanceModal from "./components/TermsAcceptanceModal";
import RunAllModal from "./components/RunAllModal";
import AIChatInline from "./components/AIChatInline";
import { hasMatchingSNPs } from "@/lib/snp-utils";
import { analyzeStudyClientSide } from "@/lib/risk-calculator";
import { isDevModeEnabled } from "@/lib/dev-mode";
import {
  trackSearch,
  trackFilterChange,
  trackFilterReset,
  trackSort,
  trackStudyClick,
  trackFeatureToggle,
  trackAPITiming,
} from "@/lib/analytics";

type SortOption = "relevance" | "power" | "recent" | "alphabetical";
type SortDirection = "asc" | "desc";
type ConfidenceBand = "high" | "medium" | "low";

type Filters = {
  search: string;
  trait: string;
  minSampleSize: string;
  maxPValue: string;
  excludeLowQuality: boolean;
  excludeMissingGenotype: boolean;
  requireUserSNPs: boolean;
  sort: SortOption;
  sortDirection: SortDirection;
  limit: number;
  confidenceBand: ConfidenceBand | null;
  offset: number;
};

type Study = {
  id: number;
  study_accession: string | null;
  study: string | null;
  disease_trait: string | null;
  mapped_trait: string | null;
  mapped_trait_uri: string | null;
  mapped_gene: string | null;
  first_author: string | null;
  date: string | null;
  journal: string | null;
  pubmedid: string | null;
  link: string | null;
  initial_sample_size: string | null;
  replication_sample_size: string | null;
  p_value: string | null;
  pvalue_mlog: string | null;
  or_or_beta: string | null;
  risk_allele_frequency: string | null;
  strongest_snp_risk_allele: string | null;
  snps: string | null;
  sampleSize: number | null;
  sampleSizeLabel: string;
  pValueNumeric: number | null;
  pValueLabel: string;
  logPValue: number | null;
  qualityFlags: Array<{ message: string; severity: string }>;
  isLowQuality: boolean;
  confidenceBand: ConfidenceBand;
  publicationDate: number | null;
  similarity?: number; // Semantic search similarity score (0-1, higher is more similar)
};

type StudiesResponse = {
  data: Study[];
  total: number;
  limit: number;
  truncated: boolean;
  sourceCount: number;
  error?: string;
};

type QualitySummary = {
  high: number;
  medium: number;
  low: number;
  flagged: number;
};

const defaultFilters: Filters = {
  search: "",
  trait: "",
  minSampleSize: "500",
  maxPValue: "5e-8",
  excludeLowQuality: true,
  excludeMissingGenotype: true,
  requireUserSNPs: false,
  sort: "relevance",
  sortDirection: "desc",
  limit: 200,
  confidenceBand: null,
  offset: 0,
};


function InfoIcon({ text }: { text: string }) {
  return (
    <span className="info-icon" role="img" aria-label="Help" title={text}>
      ⓘ
    </span>
  );
}

function parseVariantIds(snps: string | null): string[] {
  if (!snps) {
    return [];
  }
  return snps
    .split(/[;,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function getRelevanceCategory(logPValue: number | null): { label: string; className: string } {
  if (logPValue === null) return { label: "", className: "" };
  if (logPValue >= 9) return { label: "strong", className: "relevance-strong" };
  if (logPValue >= 7) return { label: "moderate", className: "relevance-moderate" };
  return { label: "weak", className: "relevance-weak" };
}

function getPowerCategory(sampleSize: number | null): { label: string; className: string } {
  if (sampleSize === null) return { label: "", className: "" };
  if (sampleSize >= 50000) return { label: "large study", className: "power-large" };
  if (sampleSize >= 5000) return { label: "medium study", className: "power-medium" };
  if (sampleSize >= 1000) return { label: "small study", className: "power-small" };
  return { label: "very small", className: "power-very-small" };
}

function getEffectCategory(effectStr: string | null): { label: string; className: string } {
  if (!effectStr) return { label: "", className: "" };
  const effect = parseFloat(effectStr);
  if (isNaN(effect)) return { label: "", className: "" };

  // Check if this looks like an odds ratio (typically > 0.5 and < 10)
  // vs a beta coefficient (can be any value, often small)
  const likelyOR = effect > 0.5 && effect < 10;

  if (likelyOR) {
    if (Math.abs(effect - 1.0) < 0.05) return { label: "no effect", className: "effect-none" };
    if (effect < 1.0) {
      if (effect <= 0.67) return { label: "protective", className: "effect-protective" };
      return { label: "slightly protective", className: "effect-slight-protective" };
    }
    if (effect >= 2.0) return { label: "large effect", className: "effect-large" };
    if (effect >= 1.5) return { label: "moderate effect", className: "effect-moderate" };
    return { label: "small effect", className: "effect-small" };
  }

  // For beta coefficients, we can't easily categorize without trait context
  return { label: "", className: "" };
}

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit));
  params.set("offset", String(filters.offset));
  params.set("sort", filters.sort);
  params.set("direction", filters.sortDirection);
  params.set("excludeLowQuality", String(filters.excludeLowQuality));
  params.set("excludeMissingGenotype", String(filters.excludeMissingGenotype));
  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.trait) {
    params.set("trait", filters.trait);
  }
  if (filters.minSampleSize.trim()) {
    params.set("minSampleSize", filters.minSampleSize.trim());
  }
  if (filters.maxPValue.trim()) {
    params.set("maxPValue", filters.maxPValue.trim());
  }
  if (filters.confidenceBand) {
    params.set("confidenceBand", filters.confidenceBand);
  }
  return params.toString();
}

type ActiveTab = "explore" | "premium";

function MainContent() {
  const { genotypeData, isUploaded, setOnDataLoadedCallback } = useGenotype();
  const { setOnResultsLoadedCallback, addResult, addResultsBatch, hasResult } = useResults();
  const resultsContext = useResults();

  // Track client-side mounting to prevent hydration errors
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize active tab (always start with 'explore' to avoid hydration issues)
  const [activeTab, setActiveTab] = useState<ActiveTab>('explore');

  // Load saved tab from localStorage after mount (dev mode only)
  useEffect(() => {
    if (isDevModeEnabled()) {
      const saved = localStorage.getItem('activeTab');
      if (saved === 'premium') {
        setActiveTab('premium');
      }
    }
  }, []);

  // Persist active tab in dev-mode
  useEffect(() => {
    if (isDevModeEnabled()) {
      localStorage.setItem('activeTab', activeTab);
    }
  }, [activeTab]);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(defaultFilters.search);
  const scrollPositionRef = useRef<number>(0);
  const isLoadingMoreRef = useRef<boolean>(false);
  const [traits, setTraits] = useState<string[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [meta, setMeta] = useState<Omit<StudiesResponse, "data" | "error">>({
    total: 0,
    limit: defaultFilters.limit,
    truncated: false,
    sourceCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [runAllProgress, setRunAllProgress] = useState({ current: 0, total: 0 });
  const [showRunAllModal, setShowRunAllModal] = useState(false);
  const [showRunAllDisclaimer, setShowRunAllDisclaimer] = useState(false);
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
  const [loadTime, setLoadTime] = useState<number | null>(null);

  // Check if user has accepted terms on mount
  useEffect(() => {
    const termsAccepted = localStorage.getItem('terms_accepted');
    if (!termsAccepted) {
      setShowTermsModal(true);
    }
  }, []);

  // Debounce search input to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 400);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const updateFilter = useCallback(<Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key !== "confidenceBand") {
        next.confidenceBand = null;
      }

      // Reset offset to 0 when any filter changes (except offset, sort, sortDirection, limit)
      // This ensures "Load More" starts fresh when user changes search/filters
      const shouldResetOffset = key !== 'offset' && key !== 'sort' && key !== 'sortDirection' && key !== 'limit';
      if (shouldResetOffset) {
        next.offset = 0;
      }

      // Track filter changes (with debouncing for search handled separately)
      if (key !== 'search' && value !== null) {
        trackFilterChange(key, value);
      }

      return next;
    });
  }, []);

  // Set up callback to auto-check "Only my variants" when genotype data is loaded
  useEffect(() => {
    setOnDataLoadedCallback(() => {
      updateFilter("requireUserSNPs", true);
    });
  }, [setOnDataLoadedCallback, updateFilter]);

  useEffect(() => {
    let active = true;
    fetch("/api/traits")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load traits");
        }
        const payload = (await response.json()) as { traits: string[]; error?: string };
        if (!active) return;
        if (payload.error) {
          throw new Error(payload.error);
        }
        setTraits(payload.traits ?? []);
      })
      .catch(() => {
        if (!active) return;
        setTraits([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Use debounced search value for API call
    const apiFilters = { ...filters, search: debouncedSearch };
    const query = buildQuery(apiFilters);
    const startTime = performance.now();
    setLoading(true);
    setError(null);

    fetch(`/api/studies?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const apiDuration = performance.now() - startTime;

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          trackAPITiming('/api/studies', apiDuration, false);
          throw new Error(payload.error ?? "Failed to load studies");
        }
        const payload = (await response.json()) as StudiesResponse;
        if (payload.error) {
          trackAPITiming('/api/studies', apiDuration, false);
          throw new Error(payload.error);
        }

        trackAPITiming('/api/studies', apiDuration, true);

        let filteredData = payload.data ?? [];

        // Client-side filtering for user SNPs
        if (apiFilters.requireUserSNPs && genotypeData) {
          filteredData = filteredData.filter(study => {
            // First check if study has matching SNPs with user data
            const hasUserSNPs = hasMatchingSNPs(genotypeData, study.snps);
            if (!hasUserSNPs) return false;

            // If "Require genotype" is also enabled, ensure the study has genotype data
            if (apiFilters.excludeMissingGenotype) {
              const hasGenotype = study.strongest_snp_risk_allele &&
                study.strongest_snp_risk_allele.trim().length > 0 &&
                study.strongest_snp_risk_allele.trim() !== '?' &&
                study.strongest_snp_risk_allele.trim() !== 'NR' &&
                !study.strongest_snp_risk_allele.includes('?');
              return hasGenotype;
            }

            return true;
          });
        }

        const endTime = performance.now();
        const totalLoadTime = endTime - startTime;
        setLoadTime(totalLoadTime);

        // Track search if there's a search query
        if (debouncedSearch.trim()) {
          trackSearch(debouncedSearch, filteredData.length, totalLoadTime);
        }

        // Append results if offset > 0 (Load More), otherwise replace
        if (apiFilters.offset > 0) {
          setStudies(prev => [...prev, ...filteredData]);
          setMeta(prev => ({
            total: prev.total + filteredData.length,
            limit: payload.limit ?? apiFilters.limit,
            truncated: payload.truncated ?? false,
            sourceCount: payload.sourceCount ?? 0,
          }));
        } else {
          setStudies(filteredData);
          setMeta({
            total: filteredData.length,
            limit: payload.limit ?? apiFilters.limit,
            truncated: payload.truncated ?? false,
            sourceCount: payload.sourceCount ?? 0,
          });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load studies");
        setStudies([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          // Restore scroll position after loading more results
          if (isLoadingMoreRef.current) {
            requestAnimationFrame(() => {
              window.scrollTo(0, scrollPositionRef.current);
              isLoadingMoreRef.current = false;
            });
          }
        }
      });

    return () => controller.abort();
  }, [debouncedSearch, filters.trait, filters.minSampleSize, filters.maxPValue, filters.excludeLowQuality, filters.excludeMissingGenotype, filters.requireUserSNPs, filters.sort, filters.sortDirection, filters.limit, filters.confidenceBand, filters.offset, genotypeData]);

  const qualitySummary = useMemo<QualitySummary>(() => {
    return studies.reduce<QualitySummary>(
      (acc, study) => {
        acc[study.confidenceBand] += 1;
        if (study.isLowQuality) {
          acc.flagged += 1;
        }
        return acc;
      },
      { high: 0, medium: 0, low: 0, flagged: 0 },
    );
  }, [studies]);

  const resetFilters = () => {
    setFilters(defaultFilters);
    setDebouncedSearch(defaultFilters.search);
    trackFilterReset();
  };


  const handleColumnSort = (sortKey: SortOption) => {
    const newDirection = filters.sort === sortKey
      ? (filters.sortDirection === "asc" ? "desc" : "asc")
      : "desc";

    if (filters.sort === sortKey) {
      // Same column clicked, toggle direction
      updateFilter("sortDirection", newDirection);
    } else {
      // New column clicked, set to desc (most common use case)
      updateFilter("sort", sortKey);
      updateFilter("sortDirection", newDirection);
    }

    // Track sort change
    trackSort(sortKey, newDirection);
  };

  const handleStudyColumnSort = () => {
    // Study column cycles between alphabetical and recent
    if (filters.sort === "alphabetical") {
      handleColumnSort("recent");
    } else if (filters.sort === "recent") {
      // Toggle direction for recent
      const newDirection = filters.sortDirection === "asc" ? "desc" : "asc";
      updateFilter("sortDirection", newDirection);
      trackSort("recent", newDirection);
    } else {
      // Start with alphabetical
      handleColumnSort("alphabetical");
    }
  };

  const handleRunAll = () => {
    if (!genotypeData || genotypeData.size === 0) {
      alert("No SNPs found in your genetic data");
      return;
    }

    // Show disclaimer first
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
    setRunAllProgress({ current: 0, total: 0 });

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
      await addResultsBatch(results); // Embeddings will be fetched on-demand during AI analysis
      const addTime = Date.now() - startAdd;
      console.log(`Finished adding ${results.length} results in ${addTime}ms`);
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

  const summaryText = useMemo(() => {
    if (error) {
      return error;
    }
    if (loading) {
      return "Loading studies…";
    }
    if (studies.length === 0) {
      return "No studies match the current filters.";
    }
    const parts = [
      `${studies.length} of ${meta.total} quality-filtered studies`,
      `${meta.sourceCount.toLocaleString()} matches before quality filters`,
    ];
    if (loadTime !== null) {
      parts.push(`loaded in ${Math.round(loadTime)}ms`);
    }
    const breakdown: string[] = [];
    if (qualitySummary.high > 0) {
      breakdown.push(`${qualitySummary.high} high`);
    }
    if (qualitySummary.medium > 0) {
      breakdown.push(`${qualitySummary.medium} medium`);
    }
    if ((qualitySummary.low > 0 && !filters.excludeLowQuality) || filters.confidenceBand === "low") {
      breakdown.push(`${qualitySummary.low} low`);
    }
    if (breakdown.length > 0) {
      parts.push(`Confidence mix: ${breakdown.join(", ")}`);
    }
    if (meta.truncated) {
      parts.push(`showing the top ${meta.limit}`);
    }
    if (qualitySummary.flagged > 0 && !filters.excludeLowQuality) {
      parts.push(`${qualitySummary.flagged} flagged as lower confidence`);
    }
    return parts.join(" · ");
  }, [
    studies.length,
    meta,
    loading,
    error,
    loadTime,
    qualitySummary.high,
    qualitySummary.medium,
    qualitySummary.low,
    qualitySummary.flagged,
    filters.excludeLowQuality,
    filters.confidenceBand,
  ]);

  return (
    <div className="app-container">
      <TermsAcceptanceModal
        isOpen={showTermsModal}
        onAccept={() => setShowTermsModal(false)}
      />
      <MenuBar />

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === "explore" ? "active" : ""}`}
          onClick={() => setActiveTab("explore")}
        >
          Explore
        </button>
        <button
          className={`tab-button ${activeTab === "premium" ? "active" : ""}`}
          onClick={() => setActiveTab("premium")}
        >
          Premium
        </button>
      </div>

      <main className="page">{activeTab === "explore" ? (
        <>
        <section className={`panel ${sectionCollapsed ? "collapsed" : ""}`}>
        <div className="panel-header">
          <div className="hero-title-section">
            {!sectionCollapsed && (
              <>
                <h2>Study Filters</h2>
                <p>Filter genetic association studies by various criteria.</p>
              </>
            )}
            {sectionCollapsed && <h3>Study Filters</h3>}
          </div>
          <div className="hero-controls">
            {!sectionCollapsed && (
              <button className="reset-button" type="button" onClick={resetFilters}>
                Reset filters
              </button>
            )}
            <button
              className="collapse-button"
              type="button"
              onClick={() => setSectionCollapsed(!sectionCollapsed)}
              title={sectionCollapsed ? "Expand" : "Collapse"}
            >
              {sectionCollapsed ? "↓" : "↑"}
            </button>
          </div>
        </div>
        {!sectionCollapsed && (
          <div className="panel-content">
            <div className="panel-row">
              <div className="panel-field">
                <label htmlFor="search">
                  Search <InfoIcon text="Search titles, authors, genes, accessions." />
                </label>
                <input
                  id="search"
                  type="search"
                  placeholder="Keywords..."
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                />
              </div>
              <div className="panel-field">
                <label htmlFor="trait">
                  Trait <InfoIcon text="Autocomplete from GWAS Catalog traits." />
                </label>
                <input
                  id="trait"
                  type="text"
                  list="trait-options"
                  placeholder="All traits"
                  value={filters.trait}
                  onChange={(event) => updateFilter("trait", event.target.value)}
                />
                <datalist id="trait-options">
                  {traits.map((traitOption) => (
                    <option key={traitOption} value={traitOption} />
                  ))}
                </datalist>
              </div>
              <div className="panel-field">
                <label htmlFor="minSample">
                  Min samples <InfoIcon text="Filter by discovery cohort size." />
                </label>
                <input
                  id="minSample"
                  type="number"
                  min={0}
                  step={100}
                  placeholder="500"
                  value={filters.minSampleSize}
                  onChange={(event) => updateFilter("minSampleSize", event.target.value)}
                />
              </div>
            </div>
            <div className="panel-row">
              <div className="panel-field">
                <label htmlFor="maxPValue">
                  Max p-value <InfoIcon text="Statistical significance threshold." />
                </label>
                <select
                  id="maxPValue"
                  value={filters.maxPValue}
                  onChange={(event) => updateFilter("maxPValue", event.target.value)}
                >
                  <option value="">Any significance (including non-significant)</option>
                  <option value="0.1">p ≤ 0.1 (Trend/suggestive)</option>
                  <option value="0.05">p ≤ 0.05 (Traditional threshold)</option>
                  <option value="0.01">p ≤ 0.01 (Strong evidence)</option>
                  <option value="1e-3">p ≤ 0.001 (Very strong)</option>
                  <option value="1e-4">p ≤ 1×10⁻⁴ (Extremely strong)</option>
                  <option value="1e-6">p ≤ 1×10⁻⁶ (Highly significant)</option>
                  <option value="5e-8">p ≤ 5×10⁻⁸ (Genome-wide significant)</option>
                  <option value="5e-9">p ≤ 5×10⁻⁹ (Ultra-stringent)</option>
                </select>
              </div>
              <div className="panel-field">
                <label htmlFor="limit">
                  Results <InfoIcon text="Number of studies to show." />
                </label>
                <select
                  id="limit"
                  value={filters.limit}
                  onChange={(event) => updateFilter("limit", Number(event.target.value))}
                >
                  {[25, 50, 75, 100, 150, 200, 1000].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel-field checkbox-field">
                <input
                  id="genotypeToggle"
                  type="checkbox"
                  checked={filters.excludeMissingGenotype}
                  onChange={(event) => updateFilter("excludeMissingGenotype", event.target.checked)}
                />
                <label htmlFor="genotypeToggle">
                  Require genotype <InfoIcon text="Hide associations without SNP risk allele." />
                </label>
              </div>
              {isUploaded && (
                <div className="panel-field checkbox-field">
                  <input
                    id="userSNPToggle"
                    type="checkbox"
                    checked={filters.requireUserSNPs}
                    onChange={(event) => updateFilter("requireUserSNPs", event.target.checked)}
                  />
                  <label htmlFor="userSNPToggle">
                    Only my variants <InfoIcon text="Show only studies with SNPs in your personal data." />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="summary" aria-live="polite">
        <p>{summaryText}</p>

      </section>

      <section className="table-wrapper" aria-busy={loading}>
        <div className="table-scroll-container">
        <table>
          <thead>
            <tr>
              <th
                scope="col"
                title="Click to sort by study title or publication date. Cycles between alphabetical and recent."
                className={`sortable ${filters.sort === "alphabetical" || filters.sort === "recent" ? "sorted" : ""}`}
                onClick={handleStudyColumnSort}
              >
                Study {filters.sort === "recent" && "(by date)"}
                <span className="info-icon">ⓘ</span>
                {(filters.sort === "alphabetical" || filters.sort === "recent") && (
                  <span className="sort-indicator">{filters.sortDirection === "asc" ? " ↑" : " ↓"}</span>
                )}
              </th>
              {studies.some(s => s.similarity !== undefined) && (
                <th
                  scope="col"
                  title="Semantic similarity score (0-1, higher is more similar). Based on vector embeddings of your search query vs study descriptions. Only shown when using search."
                  className="sortable sorted"
                >
                  Similarity <span className="info-icon">ⓘ</span>
                  <span className="sort-indicator"> ↓</span>
                </th>
              )}
              <th scope="col" title="The health condition, disease, or measurable characteristic that was studied. For example: height, diabetes, or blood pressure.">
                Trait <span className="info-icon">ⓘ</span>
              </th>
              <th scope="col" title="The specific genetic variant (SNP) associated with the trait. These are locations in DNA where people differ from each other. Click variants to see detailed genetic information.">
                Variant <span className="info-icon">ⓘ</span>
              </th>
              <th
                scope="col"
                title="Statistical strength of the finding (-log₁₀ p-value). Higher is better. Strong: ≥9, Moderate: 7-9, Weak: <7. Genome-wide significance threshold is ~7.3. Click to sort by relevance."
                className={`sortable ${filters.sort === "relevance" ? "sorted" : ""}`}
                onClick={() => handleColumnSort("relevance")}
              >
                Relevance
                <span className="info-icon">ⓘ</span>
                {filters.sort === "relevance" && (
                  <span className="sort-indicator">{filters.sortDirection === "asc" ? " ↑" : " ↓"}</span>
                )}
              </th>
              <th
                scope="col"
                title="How many people were studied (sample size). Larger is better. Large: ≥50k, Medium: 5k-50k, Small: 1k-5k, Very small: <1k. Studies with <500 participants are often unreliable. Click to sort by sample size."
                className={`sortable ${filters.sort === "power" ? "sorted" : ""}`}
                onClick={() => handleColumnSort("power")}
              >
                Power
                <span className="info-icon">ⓘ</span>
                {filters.sort === "power" && (
                  <span className="sort-indicator">{filters.sortDirection === "asc" ? " ↑" : " ↓"}</span>
                )}
              </th>
              <th scope="col" title="How much this genetic variant changes the trait. For odds ratios (OR): 1.0 = no effect, 1.1-1.5 = small effect, 1.5-2.0 = moderate effect, >2.0 = large effect. Values <1.0 indicate protective effects. For beta coefficients, the magnitude depends on the trait's measurement scale.">
                Effect <span className="info-icon">ⓘ</span>
              </th>
              <th scope="col" title="Our assessment of study reliability based on sample size, statistical significance, and data quality. High confidence studies are most trustworthy.">
                Quality <span className="info-icon">ⓘ</span>
              </th>
              <th scope="col" title="Your personal genetic result for this study. Upload your 23andMe data to see your results.">
                Your Result <span className="info-icon">ⓘ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={studies.some(s => s.similarity !== undefined) ? 9 : 8} className="loading-row">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && studies.length === 0 && (
              <tr>
                <td colSpan={studies.some(s => s.similarity !== undefined) ? 9 : 8} className="empty-row">
                  No studies found. Try widening your filters.
                </td>
              </tr>
            )}
            {!loading &&
              studies.map((study, index) => {
                const trait = study.mapped_trait ?? study.disease_trait ?? "—";
                const date = study.publicationDate
                  ? new Date(study.publicationDate).toLocaleDateString()
                  : study.date
                  ? new Date(study.date).toLocaleDateString() || study.date
                  : "—";
                const relevance = study.logPValue ? study.logPValue.toFixed(2) : "—";
                const power = study.sampleSizeLabel ?? "—";
                const effect = study.or_or_beta ?? "—";
                const relevanceCategory = getRelevanceCategory(study.logPValue);
                const powerCategory = getPowerCategory(study.sampleSize);
                const effectCategory = getEffectCategory(study.or_or_beta);
                const gwasLink = study.study_accession
                  ? `https://www.ebi.ac.uk/gwas/studies/${study.study_accession}`
                  : null;
                const studyLink =
                  gwasLink || study.link || (study.pubmedid ? `https://pubmed.ncbi.nlm.nih.gov/${study.pubmedid}` : null);
                const variantIds = parseVariantIds(study.snps);
                const variantGenotype = study.strongest_snp_risk_allele?.trim() ?? "";
                const hasGenotype = variantGenotype.length > 0;
                const confidenceLabel =
                  study.confidenceBand === "high"
                    ? "High confidence"
                    : study.confidenceBand === "medium"
                    ? "Medium confidence"
                    : "Lower confidence";
                return (
                  <tr key={`${study.id}-${index}`} className={study.isLowQuality ? "low-quality" : undefined}>
                    <td data-label="Study">
                      <div className="study-title">
                        {studyLink ? (
                          <a
                            href={studyLink}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => trackStudyClick(study.study_accession, trait, study.confidenceBand)}
                          >
                            {study.study ?? "Untitled study"}
                          </a>
                        ) : (
                          study.study ?? "Untitled study"
                        )}
                      </div>
                      <div className="study-meta">
                        <span>{study.first_author ?? "Unknown author"}</span>
                        <span>{date}</span>
                        {study.study_accession && <span>{study.study_accession}</span>}
                        {study.mapped_gene && <span>Gene: {study.mapped_gene}</span>}
                      </div>
                    </td>
                    {study.similarity !== undefined && (
                      <td data-label="Similarity">
                        <span className="metric">{study.similarity.toFixed(3)}</span>
                      </td>
                    )}
                    <td data-label="Trait">{trait}</td>
                    <td data-label="Variant & Genotype">
                      <VariantChips snps={study.snps} riskAllele={study.strongest_snp_risk_allele} />
                    </td>
                    <td data-label="Relevance">
                      <span className={`metric ${relevanceCategory.className}`}>{relevance}</span>
                      {relevanceCategory.label && (
                        <span className="submetric context-label">{relevanceCategory.label}</span>
                      )}
                      {study.pValueNumeric !== null && (
                        <span className="submetric">p = {study.pValueLabel}</span>
                      )}
                    </td>
                    <td data-label="Power">
                      <span className={`metric ${powerCategory.className}`}>{power}</span>
                      {powerCategory.label && (
                        <span className="submetric context-label">{powerCategory.label}</span>
                      )}
                      {study.initial_sample_size && (
                        <span className="submetric">Initial: {study.initial_sample_size}</span>
                      )}
                      {study.replication_sample_size && (
                        <span className="submetric">Replication: {study.replication_sample_size}</span>
                      )}
                    </td>
                    <td data-label="Effect">
                      <span className={`metric ${effectCategory.className}`}>{effect}</span>
                      {effectCategory.label && (
                        <span className="submetric context-label">{effectCategory.label}</span>
                      )}
                      {study.risk_allele_frequency && (
                        <span className="submetric">RAF: {study.risk_allele_frequency}</span>
                      )}
                    </td>
                    <td data-label="Quality">
                      <div className="quality-cell">
                        <span className={`quality-pill ${study.confidenceBand}`}>{confidenceLabel}</span>
                        {study.qualityFlags.length > 0 && (
                          <div className="quality-flags">
                            {study.qualityFlags.map((flag, index) => (
                              <span key={index} className={`quality-flag quality-flag-${flag.severity}`}>
                                {flag.message}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td data-label="Your Result">
                      <StudyResultReveal
                        studyId={study.id}
                        studyAccession={study.study_accession}
                        snps={study.snps}
                        traitName={trait}
                        studyTitle={study.study || "Untitled study"}
                      />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        </div>

        {/* Load More Button */}
        {!loading && studies.length > 0 && studies.length < meta.sourceCount && (
          <div style={{
            marginTop: '2rem',
            textAlign: 'center',
            padding: '1rem',
            borderTop: '1px solid #e0e0e0'
          }}>
            <p style={{ marginBottom: '1rem', color: '#666' }}>
              Showing {studies.length.toLocaleString()} of {meta.sourceCount.toLocaleString()} matches
            </p>
            <button
              onClick={() => {
                // Save current scroll position before loading more
                scrollPositionRef.current = window.scrollY;
                isLoadingMoreRef.current = true;
                updateFilter('offset', filters.offset + filters.limit);
              }}
              style={{
                padding: '0.75rem 2rem',
                fontSize: '1rem',
                backgroundColor: '#0070f3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0051cc'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#0070f3'}
            >
              Load More Results
            </button>
          </div>
        )}
      </section>
        </>
      ) : (
        /* Premium Tab - 3 Features with AI Chat Primary */
        <section className="premium-section">
          {/* Feature Overview Cards - Compact 3-column */}
          <div className="premium-features-overview">
            {/* AI Chat Card */}
            <div className="feature-overview-card primary">
              <div className="feature-icon">🤖</div>
              <h3>AI Chat</h3>
              <p>Ask a private LLM questions about your genetic data</p>
            </div>

            {/* Run All Card */}
            <div className="feature-overview-card">
              <div className="feature-icon">▶</div>
              <h3>Run All</h3>
              <p>
                {!mounted ? 'Loading...' :
                 !isUploaded ? 'Upload DNA data first' :
                 resultsContext.savedResults.length > 0
                  ? `${resultsContext.savedResults.length.toLocaleString()} traits analyzed`
                  : 'Analyze all GWAS studies'}
              </p>
              <button
                className="feature-quick-action"
                onClick={handleRunAll}
                disabled={isRunningAll || !mounted || !isUploaded}
              >
                {isRunningAll ? '⏳ Running...' :
                 !isUploaded ? '⚠️ Need DNA' :
                 resultsContext.savedResults.length > 0 ? '🔄 Run Again' : '▶ Start'}
              </button>
            </div>

            {/* Overview Report Card */}
            <div className="feature-overview-card disabled">
              <div className="feature-icon">📊</div>
              <div className="coming-soon-badge-small">Soon</div>
              <h3>Overview Report</h3>
              <p>AI-powered comprehensive health report</p>
              <button className="feature-quick-action" disabled>Coming Soon</button>
            </div>
          </div>

          {/* Separator */}
          <div className="premium-separator"></div>

          {/* AI Chat - Full Interface */}
          <AIChatInline />
        </section>
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
    </div>
  );
}

export default function HomePage() {
  return (
    <GenotypeProvider>
      <ResultsProvider>
        <CustomizationProvider>
          <MainContent />
        </CustomizationProvider>
      </ResultsProvider>
    </GenotypeProvider>
  );
}
