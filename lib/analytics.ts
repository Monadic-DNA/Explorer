/**
 * Simplified User Journey Analytics
 *
 * Tracks only the core user journey milestones.
 * Privacy-compliant with no PII tracking.
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
// CORE USER JOURNEY EVENTS (12 total)
// ============================================================================

/**
 * User accepted terms and moved past initial modal
 */
export function trackTermsAccepted() {
  trackEvent('terms_accepted');
}

/**
 * User ran a search query to find studies
 */
export function trackQueryRun(resultCount: number) {
  trackEvent('query_run', {
    result_count: resultCount,
  });
}

/**
 * User revealed/analyzed a study match
 */
export function trackMatchRevealed(hasUserData: boolean, matchCount: number) {
  trackEvent('match_revealed', {
    has_user_data: hasUserData,
    match_count: matchCount,
  });
}

/**
 * User ran AI analysis on a specific match
 */
export function trackAIAnalysisRun() {
  trackEvent('ai_analysis_run');
}

/**
 * User loaded a genotype file (DNA data)
 */
export function trackGenotypeFileLoaded(fileSize: number, variantCount: number) {
  trackEvent('genotype_file_loaded', {
    file_size_kb: Math.round(fileSize / 1024),
    variant_count: variantCount,
  });
}

/**
 * User loaded a previously saved results file
 */
export function trackResultsFileLoaded(resultCount: number) {
  trackEvent('results_file_loaded', {
    result_count: resultCount,
  });
}

/**
 * User saved their results to a file
 */
export function trackResultsFileSaved(resultCount: number) {
  trackEvent('results_file_saved', {
    result_count: resultCount,
  });
}

/**
 * User navigated to the Premium section
 */
export function trackPremiumSectionViewed() {
  trackEvent('premium_section_viewed');
}

/**
 * User logged in using Dynamic wallet authentication
 */
export function trackUserLoggedIn() {
  trackEvent('user_logged_in');
}

/**
 * User clicked "Run All" to analyze all studies
 */
export function trackRunAllStarted(studyCount: number) {
  trackEvent('run_all_started', {
    study_count: studyCount,
  });
}

/**
 * User asked the LLM a question in chat
 */
export function trackLLMQuestionAsked() {
  trackEvent('llm_question_asked');
}

/**
 * User generated an Overview Report
 */
export function trackOverviewReportGenerated(resultCount: number) {
  trackEvent('overview_report_generated', {
    result_count: resultCount,
  });
}

/**
 * User subscribed using a promo code
 */
export function trackSubscribedWithPromoCode(promoCode: string) {
  trackEvent('subscribed_promo_code', {
    code_type: 'delicate_prime',
  });
}

/**
 * User subscribed with credit card payment
 */
export function trackSubscribedWithCreditCard(durationDays: number) {
  trackEvent('subscribed_credit_card', {
    duration_days: durationDays,
  });
}

/**
 * User subscribed with stablecoin payment
 */
export function trackSubscribedWithStablecoin(durationDays: number) {
  trackEvent('subscribed_stablecoin', {
    duration_days: durationDays,
  });
}

/**
 * User updated their personalization settings
 */
export function trackPersonalizationUpdated() {
  trackEvent('personalization_updated');
}

/**
 * User switched AI provider
 */
export function trackAIProviderSwitched(newProvider: string) {
  trackEvent('ai_provider_switched', {
    provider: newProvider,
  });
}

// ============================================================================
// DEPRECATED FUNCTIONS (for backwards compatibility during migration)
// These will be removed once all components are updated
// ============================================================================

/** @deprecated Use trackGenotypeFileLoaded instead */
export function trackFileUploadSuccess(fileSize: number, variantCount: number) {
  trackGenotypeFileLoaded(fileSize, variantCount);
}

/** @deprecated Use trackQueryRun instead */
export function trackSearch(query: string, resultCount: number, loadTime: number) {
  trackQueryRun(resultCount);
}

/** @deprecated Use trackMatchRevealed instead */
export function trackStudyResultReveal(hasUserData: boolean, matchCount: number, confidenceBand: string) {
  trackMatchRevealed(hasUserData, matchCount);
}

/** @deprecated Use trackAIAnalysisRun instead */
export function trackAIAnalysisStart(studyCount: number) {
  trackAIAnalysisRun();
}

/** @deprecated Use trackTermsAccepted instead */
export function trackTermsAcceptance() {
  trackTermsAccepted();
}

// Stub out removed functions to prevent errors during migration
export function trackFileUploadStart() {}
export function trackFileUploadError() {}
export function trackFileCleared() {}
export function trackFilterChange() {}
export function trackFilterReset() {}
export function trackSort() {}
export function trackStudyClick() {}
export function trackVariantClick() {}
export function trackModalOpen() {}
export function trackModalClose() {}
export function trackDisclaimerView() {}
export function trackAIConsentGiven() {}
export function trackAIConsentDeclined() {}
export function trackAIAnalysisSuccess() {}
export function trackAIAnalysisError() {}
export function trackAPITiming() {}
export function trackPageLoad() {}
export function trackFeatureToggle() {}
export function trackExport() {}
export function trackUserJourneyStep() {}
export function trackEngagement() {}
