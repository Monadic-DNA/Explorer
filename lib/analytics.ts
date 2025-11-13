/**
 * Google Analytics Event Tracking
 *
 * Privacy-compliant event tracking for user behavior insights.
 * All events are anonymized and contain no PII.
 */

// Extend Window interface to include gtag
declare global {
  interface Window {
    gtag?: (
      command: 'event' | 'config' | 'js',
      targetOrAction: string,
      params?: Record<string, any>
    ) => void;
    dataLayer?: any[];
  }
}

/**
 * Safely send an event to Google Analytics
 */
function trackEvent(eventName: string, params?: Record<string, any>) {
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('event', eventName, params);
    } catch (error) {
      console.warn('Analytics tracking failed:', error);
    }
  }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

export function trackFileUploadStart(fileSize: number, fileExtension: string) {
  trackEvent('file_upload_start', {
    file_size_kb: Math.round(fileSize / 1024),
    file_extension: fileExtension.toLowerCase(),
  });
}

export function trackFileUploadSuccess(
  fileSize: number,
  variantCount: number,
  parseDuration: number
) {
  trackEvent('file_upload_success', {
    file_size_kb: Math.round(fileSize / 1024),
    variant_count: variantCount,
    parse_duration_ms: Math.round(parseDuration),
  });
}

export function trackFileUploadError(error: string, fileSize?: number) {
  trackEvent('file_upload_error', {
    error_type: error.substring(0, 100), // Limit length
    file_size_kb: fileSize ? Math.round(fileSize / 1024) : undefined,
  });
}

export function trackFileCleared() {
  trackEvent('file_cleared');
}

// ============================================================================
// SEARCH & FILTERS
// ============================================================================

export function trackSearch(query: string, resultCount: number, loadTime: number) {
  // Anonymize query - only track length and result count
  trackEvent('search', {
    query_length: query.length,
    result_count: resultCount,
    load_time_ms: Math.round(loadTime),
  });
}

export function trackFilterChange(
  filterType: string,
  filterValue: string | number | boolean
) {
  const sanitizedValue =
    typeof filterValue === 'string'
      ? filterValue.substring(0, 50) // Limit string length
      : filterValue;

  trackEvent('filter_change', {
    filter_type: filterType,
    filter_value: String(sanitizedValue),
  });
}

export function trackFilterReset() {
  trackEvent('filter_reset');
}

export function trackSort(sortBy: string, direction: string) {
  trackEvent('sort_change', {
    sort_by: sortBy,
    direction,
  });
}

// ============================================================================
// STUDY INTERACTIONS
// ============================================================================

export function trackStudyClick(
  studyAccession: string | null,
  trait: string | null,
  confidenceBand: string
) {
  trackEvent('study_click', {
    has_accession: !!studyAccession,
    trait_category: trait?.substring(0, 50) || 'unknown',
    confidence_band: confidenceBand,
  });
}

export function trackStudyResultReveal(
  hasUserData: boolean,
  matchCount: number,
  confidenceBand: string
) {
  trackEvent('study_result_reveal', {
    has_user_data: hasUserData,
    match_count: matchCount,
    confidence_band: confidenceBand,
  });
}

export function trackVariantClick(rsid: string) {
  trackEvent('variant_click', {
    rsid,
  });
}

// ============================================================================
// MODAL INTERACTIONS
// ============================================================================

export function trackModalOpen(modalName: string) {
  trackEvent('modal_open', {
    modal_name: modalName,
  });
}

export function trackModalClose(modalName: string, action: 'accept' | 'decline' | 'dismiss') {
  trackEvent('modal_close', {
    modal_name: modalName,
    action,
  });
}

export function trackTermsAcceptance() {
  trackEvent('terms_accepted');
}

export function trackDisclaimerView() {
  trackEvent('disclaimer_viewed');
}

export function trackAIConsentGiven() {
  trackEvent('ai_consent_given');
}

export function trackAIConsentDeclined() {
  trackEvent('ai_consent_declined');
}

// ============================================================================
// LLM ANALYSIS
// ============================================================================

export function trackAIAnalysisStart(studyCount: number) {
  trackEvent('llm_analysis_start', {
    study_count: studyCount,
  });
}

export function trackAIAnalysisSuccess(duration: number, studyCount: number) {
  trackEvent('llm_analysis_success', {
    duration_ms: Math.round(duration),
    study_count: studyCount,
  });
}

export function trackAIAnalysisError(error: string) {
  trackEvent('llm_analysis_error', {
    error_type: error.substring(0, 100),
  });
}

// ============================================================================
// PERFORMANCE METRICS
// ============================================================================

export function trackAPITiming(endpoint: string, duration: number, success: boolean) {
  trackEvent('api_timing', {
    endpoint,
    duration_ms: Math.round(duration),
    success,
  });
}

export function trackPageLoad(loadTime: number) {
  trackEvent('page_load', {
    load_time_ms: Math.round(loadTime),
  });
}

// ============================================================================
// FEATURE USAGE
// ============================================================================

export function trackFeatureToggle(featureName: string, enabled: boolean) {
  trackEvent('feature_toggle', {
    feature: featureName,
    enabled,
  });
}

export function trackExport(exportType: string, itemCount: number) {
  trackEvent('export', {
    export_type: exportType,
    item_count: itemCount,
  });
}

// ============================================================================
// USER JOURNEY
// ============================================================================

export function trackUserJourneyStep(step: string, metadata?: Record<string, any>) {
  trackEvent('user_journey', {
    step,
    ...metadata,
  });
}

export function trackEngagement(action: string, value?: number) {
  trackEvent('engagement', {
    action,
    value,
  });
}
