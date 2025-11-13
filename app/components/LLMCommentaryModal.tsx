"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SavedResult } from "@/lib/results-manager";
import NilAIConsentModal from "./NilAIConsentModal";
import StudyQualityIndicators from "./StudyQualityIndicators";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import { callLLM, getLLMDescription } from "@/lib/llm-client";

type LLMCommentaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentResult: SavedResult;
  allResults: SavedResult[]; // Deprecated - will use SQL query instead
};

const CONSENT_STORAGE_KEY = "nilai_llm_consent_accepted";

// Helper function to format risk scores consistently
function formatRiskScore(score: number, level: string, effectType?: 'OR' | 'beta'): string {
  if (level === 'neutral') return effectType === 'beta' ? 'baseline' : '1.0x';
  if (effectType === 'beta') {
    return `β=${score >= 0 ? '+' : ''}${score.toFixed(3)} units`;
  }
  return `${score.toFixed(2)}x`;
}

export default function LLMCommentaryModal({
  isOpen,
  onClose,
  currentResult,
  allResults, // Deprecated parameter
}: LLMCommentaryModalProps) {
  const resultsContext = useResults();
  const { getTopResultsByRelevance } = resultsContext;
  const { customization, status: customizationStatus } = useCustomization();
  const [commentary, setCommentary] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delegationStatus, setDelegationStatus] = useState<string>("");
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showPersonalizationPrompt, setShowPersonalizationPrompt] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [studyMetadata, setStudyMetadata] = useState<any>(null);
  const [loadingPhase, setLoadingPhase] = useState<'query' | 'metadata' | 'token' | 'llm' | 'done'>('query');
  const [resultsCount, setResultsCount] = useState<number>(0);
  const [analysisResultsCount, setAnalysisResultsCount] = useState<number>(0);
  const [analysisResults, setAnalysisResults] = useState<SavedResult[]>([]);
  const [hasCustomization, setHasCustomization] = useState<boolean>(false);
  const [usedSemanticSearch, setUsedSemanticSearch] = useState<boolean>(false);

  useEffect(() => {
    // Check if user has previously consented
    if (typeof window !== "undefined") {
      const consent = localStorage.getItem(CONSENT_STORAGE_KEY);
      setHasConsent(consent === "true");
    }
  }, []);

  useEffect(() => {
    console.log('[LLMCommentaryModal] isOpen changed:', isOpen, 'hasConsent:', hasConsent);
    if (isOpen) {
      // Check if personalization is not set or locked
      if (customizationStatus === 'not-set' || customizationStatus === 'locked') {
        console.log('[LLMCommentaryModal] Showing personalization prompt');
        setShowPersonalizationPrompt(true);
      } else {
        // Always show consent modal first, even if consent was previously given
        // This ensures user explicitly triggers the analysis each time
        console.log('[LLMCommentaryModal] Showing consent modal');
        setShowConsentModal(true);
      }
    }
  }, [isOpen, customizationStatus]);

  const handleConsentAccept = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(CONSENT_STORAGE_KEY, "true");
      setHasConsent(true);
      setShowConsentModal(false);
      fetchCommentary();
    }
  };

  const handleConsentDecline = () => {
    setShowConsentModal(false);
    onClose();
  };

  const fetchCommentary = async () => {
    console.log('[fetchCommentary] Starting...');
    setIsLoading(true);
    setError(null);
    setCommentary("");
    setDelegationStatus("");
    setStudyMetadata(null);
    setLoadingPhase('query');

    try {
      // Phase 1: Query database for relevant results
      const totalResults = resultsContext.savedResults.length;
      console.log('[fetchCommentary] Total results:', totalResults);
      setResultsCount(totalResults);
      setLoadingPhase('query');
      setDelegationStatus(`Querying ${totalResults.toLocaleString()} results...`);

      // Yield to UI to show loading state
      await new Promise(resolve => setTimeout(resolve, 50));

      console.log(`[fetchCommentary] Fetching top relevant results from ${totalResults} total using semantic search (5000 studies from embeddings)...`);
      const startFilter = Date.now();

      // Use semantic search to find results most relevant to this trait/study
      // Query 5000 studies from PostgreSQL to cast a wider net, then filter to top 499 matches
      // Use only the trait name (condition) for semantic search, not the full study title
      setDelegationStatus(`Analyzing semantic relevance (may generate embeddings on first use)...`);
      const queryText = currentResult.traitName;
      let topResults = await getTopResultsByRelevance(queryText, 5000, currentResult.gwasId);
      console.log(`[fetchCommentary] Got ${topResults.length} results from semantic search (queried 5000 studies)`);

      // Take only top 499 matches for the LLM prompt
      topResults = topResults.slice(0, 499);
      console.log(`[fetchCommentary] Using top ${topResults.length} results for LLM prompt`);

      // If we have fewer than 499 results, fill remaining slots with highest risk score results
      if (topResults.length < 499) {
        const remaining = 499 - topResults.length;
        console.log(`[fetchCommentary] Only ${topResults.length} semantically relevant results. Filling ${remaining} slots with high-risk results...`);
        console.log(`[fetchCommentary] Total savedResults available: ${resultsContext.savedResults.length}`);

        // Track existing study IDs to avoid duplicates
        const existingStudyIds = new Set(topResults.map(r => r.studyId));

        // Debug: Check a sample result structure
        const sampleResult = resultsContext.savedResults[0];
        console.log(`[fetchCommentary] Sample result structure:`, {
          hasGwasId: !!sampleResult?.gwasId,
          hasPValue: !!sampleResult?.pValue,
          hasSampleSize: !!sampleResult?.sampleSize,
          keys: sampleResult ? Object.keys(sampleResult) : []
        });

        // Step 1: Filter by gwasId
        const withGwasId = resultsContext.savedResults.filter(r => r.gwasId !== currentResult.gwasId);
        console.log(`[fetchCommentary] After excluding current gwasId: ${withGwasId.length}`);

        // Step 2: Filter by existing study IDs
        const noDuplicates = withGwasId.filter(r => !existingStudyIds.has(r.studyId));
        console.log(`[fetchCommentary] After excluding duplicates: ${noDuplicates.length}`);

        // Step 3: Apply quality filters (only if fields exist)
        const qualityFiltered = noDuplicates.filter(r => {
          // If pValue exists, apply threshold (genome-wide significance: < 5e-8)
          if (r.pValue) {
            const pValue = parseFloat(r.pValue);
            if (!isNaN(pValue) && pValue >= 5e-8) {
              return false;
            }
          }

          // If sampleSize exists, apply threshold (>= 500 participants)
          if (r.sampleSize) {
            // Parse sample size from text like "15,000 European ancestry individuals"
            const sampleSizeMatch = r.sampleSize.match(/[\d,]+/);
            if (sampleSizeMatch) {
              const sampleSize = parseInt(sampleSizeMatch[0].replace(/,/g, ''));
              if (!isNaN(sampleSize) && sampleSize < 500) {
                return false;
              }
            }
          }

          // If neither field exists (old results), include all results
          return true;
        });

        console.log(`[fetchCommentary] After quality filters: ${qualityFiltered.length}`);

        // Step 4: Random sampling to avoid bias toward high-risk results
        // Shuffle using Fisher-Yates algorithm
        const shuffled = [...qualityFiltered];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const randomSample = shuffled.slice(0, remaining);
        console.log(`[fetchCommentary] Randomly sampled ${randomSample.length} results from ${qualityFiltered.length} quality-filtered results`);

        topResults = [...topResults, ...randomSample];
        console.log(`[fetchCommentary] Added ${randomSample.length} results. Final total: ${topResults.length}`);
      }

      // Add current result at the top
      const resultsForContext = [currentResult, ...topResults];

      const filterTime = Date.now() - startFilter;
      console.log(`Fetched top 5000 results in ${filterTime}ms using semantic similarity search`);

      // Store analysis metadata
      setAnalysisResultsCount(resultsForContext.length);
      setAnalysisResults(resultsForContext);
      setHasCustomization(!!(customization && (
        customization.ethnicities.length > 0 ||
        customization.countriesOfOrigin.length > 0 ||
        customization.genderAtBirth ||
        customization.age ||
        (customization.personalConditions && customization.personalConditions.length > 0) ||
        (customization.familyConditions && customization.familyConditions.length > 0)
      )));

      // Check console logs to detect if semantic search was actually used
      // If we see the fallback warning, semantic search failed
      setUsedSemanticSearch(topResults.length > 0);

      setDelegationStatus(`✓ Selected ${resultsForContext.length} most relevant results (${filterTime}ms)`);

      // Yield to UI after query
      await new Promise(resolve => setTimeout(resolve, 100));

      // Phase 2: Fetch study metadata for quality indicators
      setLoadingPhase('metadata');
      setDelegationStatus("Fetching study quality indicators...");
      await new Promise(resolve => setTimeout(resolve, 50));

      const metadataResponse = await fetch(`/api/study-metadata?studyId=${currentResult.studyId}`);
      if (metadataResponse.ok) {
        const metadataData = await metadataResponse.json();
        setStudyMetadata(metadataData.metadata);
        setDelegationStatus("✓ Study metadata loaded");
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Phase 3: Prepare LLM analysis
      setLoadingPhase('token');
      setDelegationStatus("Preparing LLM analysis...");
      await new Promise(resolve => setTimeout(resolve, 50));

      // Phase 4: Generate LLM commentary
      setLoadingPhase('llm');
      setDelegationStatus("Generating LLM analysis (this may take 30-60 seconds)...");

      const contextResults = resultsForContext
        .map((r: SavedResult, idx: number) =>
          `${idx + 1}. ${r.traitName} (${r.studyTitle}):
   - Your genotype: ${r.userGenotype}
   - Risk allele: ${r.riskAllele}
   - Effect size: ${r.effectSize}
   - Risk score: ${formatRiskScore(r.riskScore, r.riskLevel, r.effectType)} (${r.riskLevel})
   - Matched SNP: ${r.matchedSnp}`
        )
        .join('\n\n');

      // Construct study quality context
      let studyQualityContext = '';
      if (studyMetadata) {
        const parseSampleSize = (str: string | null) => {
          if (!str) return 0;
          const match = str.match(/[\d,]+/);
          return match ? parseInt(match[0].replace(/,/g, '')) : 0;
        };

        const initialSize = parseSampleSize(studyMetadata.initial_sample_size);
        const replicationSize = parseSampleSize(studyMetadata.replication_sample_size);

        studyQualityContext = `
STUDY QUALITY INDICATORS (USE THESE TO TEMPER YOUR INTERPRETATION):
- Sample Size: ${initialSize.toLocaleString()} participants ${initialSize < 5000 ? '(SMALL STUDY - interpret with caution)' : initialSize < 50000 ? '(medium study)' : '(large, well-powered study)'}
- Ancestry: ${studyMetadata.initial_sample_size || 'Not specified'} ${studyMetadata.initial_sample_size?.toLowerCase().includes('european') ? '(may not generalize to other ancestries - IMPORTANT LIMITATION)' : ''}
- Replication: ${replicationSize > 0 ? `Yes (${replicationSize.toLocaleString()} participants)` : 'No independent replication (interpret with caution)'}
- P-value: ${studyMetadata.p_value || 'Not reported'} ${parseFloat(studyMetadata.p_value || '1') > 5e-8 ? '(NOT genome-wide significant - findings are suggestive only)' : '(genome-wide significant)'}
- Publication: ${studyMetadata.first_author || 'Unknown'}, ${studyMetadata.date || 'Unknown date'} ${studyMetadata.journal ? `in ${studyMetadata.journal}` : ''}

CRITICAL: You MUST acknowledge these study limitations in your commentary. If sample size is small, ancestry is limited, or replication is lacking, explicitly mention this reduces confidence in the findings.`;
      }

      // Build user context from customization data
      let userContext = '';
      if (customization) {
        const parts = [];
        if (customization.ethnicities.length > 0) {
          parts.push(`Ethnicities: ${customization.ethnicities.join(', ')}`);
        }
        if (customization.countriesOfOrigin.length > 0) {
          parts.push(`Countries of ancestral origin: ${customization.countriesOfOrigin.join(', ')}`);
        }
        if (customization.genderAtBirth) {
          parts.push(`Gender assigned at birth: ${customization.genderAtBirth}`);
        }
        if (customization.age) {
          parts.push(`Age: ${customization.age}`);
        }
        if (customization.personalConditions && customization.personalConditions.length > 0) {
          parts.push(`Personal medical history: ${customization.personalConditions.join(', ')}`);
        }
        if (customization.familyConditions && customization.familyConditions.length > 0) {
          parts.push(`Family medical history: ${customization.familyConditions.join(', ')}`);
        }

        if (parts.length > 0) {
          userContext = `

USER BACKGROUND (CONFIDENTIAL - USE TO PERSONALIZE INTERPRETATION):
${parts.join('\n')}

IMPORTANT: Consider how this user's background (ancestry, age, gender, family history) may affect their risk profile and the applicability of these study findings. Be specific about ancestry-related limitations if the study population doesn't match the user's background.`;
        }
      }

      const prompt = `You are a genetic counselor providing educational commentary on GWAS (Genome-Wide Association Study) results.

IMPORTANT DISCLAIMERS TO INCLUDE:
1. This is for educational and entertainment purposes only
2. This is NOT medical advice and should not be used for medical decisions
3. GWAS results show statistical associations, not deterministic outcomes
4. Genetic risk is just one factor among many (lifestyle, environment, other genes)
5. Always consult healthcare professionals for medical interpretation
6. These results come from research studies and may not be clinically validated
${studyQualityContext}${userContext}

CURRENT RESULT TO ANALYZE:
Trait: ${currentResult.traitName}
Study: ${currentResult.studyTitle}
Your genotype: ${currentResult.userGenotype}
Risk allele: ${currentResult.riskAllele}
Effect size: ${currentResult.effectSize}
Risk score: ${formatRiskScore(currentResult.riskScore, currentResult.riskLevel, currentResult.effectType)} (${currentResult.riskLevel})
Matched SNP: ${currentResult.matchedSnp}
Study date: ${currentResult.analysisDate}

ALL YOUR SAVED RESULTS FOR CONTEXT:
${contextResults}

Please provide:
1. A brief, plain-language summary of what this research study found (what scientists were investigating and what they discovered)
2. A clear explanation of what this result means for the user specifically
3. Context about the trait/condition in terms anyone can understand
4. Interpretation of the risk level in practical terms
5. How this relates to any other results they have (if applicable)
6. Appropriate disclaimers and next steps

Keep your response concise (400-600 words), educational, and reassuring where appropriate. Use clear, accessible language suitable for someone with no scientific background. Avoid jargon, and when technical terms are necessary, explain them simply.`;

      // Make request using centralized client
      // Use LOW reasoning effort for fast individual result explanations
      const response = await callLLM([
        {
          role: "system",
          content: "You are a knowledgeable genetic counselor who explains GWAS results clearly and responsibly, always emphasizing appropriate disclaimers and limitations."
        },
        {
          role: "user",
          content: prompt
        }
      ], {
        maxTokens: 1800,
        temperature: 0.7,
        reasoningEffort: 'low',
      });

      const commentaryText = response.content;

      if (!commentaryText) {
        throw new Error("No commentary generated from LLM");
      }

      setDelegationStatus("✓ LLM analysis complete - formatting response...");
      setLoadingPhase('done');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Convert markdown to plain HTML (simple conversion without external libraries)
      const processedText = commentaryText
        // Bold: **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        // Italic: *text* or _text_
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        // Headers: ## text
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>')
        // Lists: - item or * item
        .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
        // Wrap consecutive <li> in <ul>
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        // Convert double newlines to paragraph breaks
        .split('\n\n')
        .map(para => para.trim())
        .filter(para => para.length > 0)
        .map(para => {
          // Don't wrap if already a block element
          if (para.startsWith('<h') || para.startsWith('<ul')) {
            return para;
          }
          return `<p>${para}</p>`;
        })
        .join('');

      setCommentary(processedText);
    } catch (err) {
      console.error('[fetchCommentary] Error occurred:', err);
      const errorMessage = err instanceof Error ? err.message : "Failed to generate commentary";
      console.error('[fetchCommentary] Error message:', errorMessage);
      setError(errorMessage);

      // Check if it's a configuration error
      if (errorMessage.includes("API key not configured")) {
        setError("LLM commentary is not configured. The NILLION_API_KEY environment variable needs to be set.");
      }
    } finally {
      console.log('[fetchCommentary] Finally block, setting isLoading to false');
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    fetchCommentary();
  };

  const handlePrint = () => {
    // Create a print-friendly version of the content
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print the analysis');
      return;
    }

    // Generate studies list HTML
    const studiesListHtml = analysisResults.map((result, index) => `
      <div class="study-item" style="margin-bottom: 20px; padding: 15px; background: ${index === 0 ? '#fff9e6' : '#f8f9fa'}; border-radius: 8px; page-break-inside: avoid;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="font-weight: bold; color: #555;">${index + 1}.</span>
          <span style="font-weight: 600; color: #2c3e50; flex: 1;">${result.traitName}</span>
          ${index === 0 ? '<span style="background: #ffc107; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">CURRENT</span>' : ''}
        </div>
        <div style="margin-left: 24px; font-size: 14px; color: #555;">
          <p style="margin: 4px 0;"><strong>Study:</strong> ${result.studyTitle}</p>
          <p style="margin: 4px 0;"><strong>Your genotype:</strong> ${result.userGenotype}</p>
          <p style="margin: 4px 0;"><strong>Risk score:</strong> <span style="color: ${result.riskLevel === 'increased' ? '#dc3545' : result.riskLevel === 'decreased' ? '#28a745' : '#6c757d'}; font-weight: 600;">${formatRiskScore(result.riskScore, result.riskLevel, result.effectType)} (${result.riskLevel})</span></p>
          <p style="margin: 4px 0;"><strong>SNP:</strong> ${result.matchedSnp}</p>
        </div>
      </div>
    `).join('');

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>LLM Analysis - ${currentResult.traitName}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              line-height: 1.6;
              max-width: 900px;
              margin: 0 auto;
              padding: 30px;
              color: #1a1a1a;
              background: white;
            }
            .header {
              text-align: center;
              border-bottom: 3px solid #2c5aa0;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
              color: #2c5aa0;
              font-weight: 700;
            }
            .header .url {
              margin: 8px 0 0 0;
              font-size: 16px;
              color: #2c5aa0;
              font-weight: 500;
            }
            .powered-by {
              background: #e8f4f8;
              padding: 12px 20px;
              border-radius: 8px;
              text-align: center;
              margin: 20px 0;
              font-size: 13px;
              color: #2c5aa0;
            }
            h2 {
              color: #2c3e50;
              font-size: 22px;
              margin-top: 30px;
              margin-bottom: 15px;
              border-bottom: 2px solid #e0e0e0;
              padding-bottom: 8px;
            }
            h3 {
              color: #2c3e50;
              font-size: 18px;
              margin-top: 25px;
              margin-bottom: 12px;
            }
            h4 {
              color: #2c3e50;
              font-size: 16px;
              margin-top: 20px;
              margin-bottom: 10px;
            }
            .result-summary {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 25px;
              border-radius: 12px;
              margin: 25px 0;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .result-summary h2 {
              color: white;
              border: none;
              margin-top: 0;
              font-size: 24px;
            }
            .result-summary p {
              margin: 8px 0;
              font-size: 15px;
            }
            .result-summary strong {
              opacity: 0.9;
            }
            .quality-indicators {
              background: #f0f7ff;
              border-left: 4px solid #2c5aa0;
              padding: 20px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .quality-indicators h3 {
              margin-top: 0;
              color: #2c5aa0;
            }
            .quality-indicators p {
              margin: 8px 0;
              font-size: 14px;
            }
            .analysis-metadata {
              background: #e8f4f8;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .metadata-item {
              display: flex;
              align-items: center;
              gap: 10px;
              margin: 10px 0;
              font-size: 14px;
            }
            .metadata-icon {
              font-size: 18px;
            }
            .commentary-section {
              background: white;
              padding: 25px;
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              margin: 25px 0;
            }
            .commentary-section h3 {
              margin-top: 0;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .commentary-body {
              font-size: 15px;
              line-height: 1.8;
            }
            .commentary-body p {
              margin: 15px 0;
            }
            .commentary-body ul {
              margin: 15px 0;
              padding-left: 30px;
            }
            .commentary-body li {
              margin: 8px 0;
            }
            .commentary-body strong {
              font-weight: 600;
              color: #2c3e50;
            }
            .commentary-body em {
              font-style: italic;
            }
            .disclaimer {
              background: #fff3cd;
              border: 2px solid #ffc107;
              padding: 20px;
              border-radius: 8px;
              margin: 25px 0;
              page-break-inside: avoid;
            }
            .disclaimer strong {
              color: #856404;
              font-size: 16px;
            }
            .disclaimer p {
              margin: 10px 0 0 0;
              color: #856404;
              font-size: 14px;
            }
            .studies-section {
              margin-top: 40px;
              page-break-before: always;
            }
            .studies-section h2 {
              color: #2c5aa0;
            }
            .study-item strong {
              color: #2c3e50;
            }
            .footer {
              margin-top: 50px;
              padding-top: 20px;
              border-top: 2px solid #e0e0e0;
              text-align: center;
              font-size: 12px;
              color: #666;
            }
            .footer p {
              margin: 5px 0;
            }
            @media print {
              body {
                margin: 0;
                padding: 20px;
              }
              .header {
                page-break-after: avoid;
              }
              .result-summary {
                page-break-inside: avoid;
              }
              .disclaimer {
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Monadic DNA Explorer</h1>
            <div class="url">https://explorer.monadicdna.com/</div>
          </div>

          <div class="powered-by">
            🛡️ Powered by <strong>Nillion nilAI</strong> - Privacy-preserving AI in a Trusted Execution Environment
          </div>

          <h2>🤖 AI Commentary on Your Genetic Result</h2>

          <div class="result-summary">
            <h2>${currentResult.traitName}</h2>
            <p><strong>Study:</strong> ${currentResult.studyTitle}</p>
            <p><strong>Your genotype:</strong> ${currentResult.userGenotype}</p>
            <p><strong>Risk allele:</strong> ${currentResult.riskAllele}</p>
            <p><strong>Effect size:</strong> ${currentResult.effectSize}</p>
            <p><strong>Risk score:</strong> ${formatRiskScore(currentResult.riskScore, currentResult.riskLevel, currentResult.effectType)} (${currentResult.riskLevel})</p>
            <p><strong>Matched SNP:</strong> ${currentResult.matchedSnp}</p>
          </div>

          ${studyMetadata ? `
            <div class="quality-indicators">
              <h3>📊 Study Quality Indicators</h3>
              <p><strong>Sample Size:</strong> ${studyMetadata.initial_sample_size || 'Not specified'}</p>
              <p><strong>Replication:</strong> ${studyMetadata.replication_sample_size || 'No independent replication'}</p>
              <p><strong>P-value:</strong> ${studyMetadata.p_value || 'Not reported'}</p>
              <p><strong>Publication:</strong> ${studyMetadata.first_author || 'Unknown'}, ${studyMetadata.date || 'Unknown date'}${studyMetadata.journal ? ` in ${studyMetadata.journal}` : ''}</p>
            </div>
          ` : ''}

          <div class="analysis-metadata">
            <h3>Analysis Details</h3>
            <div class="metadata-item">
              <span class="metadata-icon">📊</span>
              <span><strong>Results analyzed:</strong> ${analysisResultsCount.toLocaleString()}</span>
            </div>
            <div class="metadata-item">
              <span class="metadata-icon">👤</span>
              <span><strong>Personalization:</strong> ${hasCustomization ? 'Enabled' : 'Not configured'}</span>
            </div>
            <div class="metadata-item">
              <span class="metadata-icon">🔍</span>
              <span><strong>Selection method:</strong> Semantic relevance matching</span>
            </div>
          </div>

          <div class="commentary-section">
            <h3><span class="commentary-icon">🤖</span>LLM-Generated Interpretation</h3>
            <div class="commentary-body">
              ${commentary}
            </div>
          </div>

          <div class="disclaimer">
            <strong>⚠️ LLM-Generated Content Limitations</strong>
            <p>
              This commentary is generated by an LLM model and may not fully account for study
              limitations, your specific ancestry, the latest research, or individual medical factors.
              It should be used for educational purposes only. Always consult a healthcare professional
              or genetic counselor for personalized medical interpretation and advice.
            </p>
          </div>

          <div class="studies-section">
            <h2>📚 All Studies Used in This Analysis (${analysisResults.length} total)</h2>
            <p style="color: #666; font-size: 14px; margin-bottom: 20px;">
              The following studies were provided to the LLM for context in generating this analysis.
              The first study (highlighted) is the primary result you selected.
            </p>
            ${studiesListHtml}
          </div>

          <div class="footer">
            <p><strong>Generated on ${new Date().toLocaleString()}</strong></p>
            <p>Monadic DNA Explorer • https://explorer.monadicdna.com/</p>
          </div>

          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  const handlePersonalizationPromptClose = () => {
    setShowPersonalizationPrompt(false);
    onClose();
  };

  const handlePersonalizationPromptContinue = () => {
    setShowPersonalizationPrompt(false);
    setShowConsentModal(true);
  };

  if (!isOpen) return null;

  // Show personalization prompt if needed
  if (showPersonalizationPrompt) {
    const modalContent = (
      <div className="modal-overlay" onClick={handlePersonalizationPromptClose}>
        <div
          className="modal-dialog consent-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-content">
            <h2>📋 Personalization Recommended</h2>
            <div className="consent-content">
              <p>
                For the best LLM analysis experience, we recommend {customizationStatus === 'not-set' ? 'setting up' : 'unlocking'} your personalization information.
              </p>
              <p>
                Personalized analysis provides more relevant insights based on your:
              </p>
              <ul>
                <li>Ancestry and ethnic background</li>
                <li>Age and gender</li>
                <li>Personal medical history</li>
                <li>Family medical history</li>
              </ul>
              {customizationStatus === 'locked' && (
                <p className="consent-disclaimer">
                  <strong>How to unlock:</strong> Click "Unlock Personalization" below (this will close this dialog), then click the "🔒 Personalization" button in the menu bar at the top of the page, and enter your password to unlock your data. After unlocking, click LLM analysis again.
                </p>
              )}
              {customizationStatus === 'not-set' && (
                <p className="consent-disclaimer">
                  <strong>How to set up:</strong> Click "Set Up Personalization" below (this will close this dialog), then click the "👤 Personalization" button in the menu bar at the top of the page to enter your information. After saving, click LLM analysis again.
                </p>
              )}
              <p className="consent-disclaimer">
                You can also continue without personalization, but the LLM analysis will be less tailored to your background.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="disclaimer-button secondary"
                onClick={handlePersonalizationPromptContinue}
              >
                Continue Without Personalization
              </button>
              <button
                className="disclaimer-button primary"
                onClick={handlePersonalizationPromptClose}
              >
                {customizationStatus === 'not-set' ? 'Set Up Personalization' : 'Unlock Personalization'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
    return typeof document !== 'undefined'
      ? createPortal(modalContent, document.body)
      : null;
  }

  const modalContent = showConsentModal ? (
    <NilAIConsentModal
      isOpen={showConsentModal}
      onAccept={handleConsentAccept}
      onDecline={handleConsentDecline}
    />
  ) : (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog commentary-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <h2>🤖 AI Commentary on Your Result</h2>

          <div className="commentary-powered-by-header">
            <p className="powered-by">
              {getLLMDescription()}
            </p>
          </div>

          <div className="commentary-result-summary">
            <h3>{currentResult.traitName}</h3>
            <p className="commentary-study-title">{currentResult.studyTitle}</p>
            <div className="commentary-result-details">
              <span>
                <strong>Your genotype:</strong> {currentResult.userGenotype}
              </span>
              <span>
                <strong>Risk score:</strong> {formatRiskScore(currentResult.riskScore, currentResult.riskLevel, currentResult.effectType)} ({currentResult.riskLevel})
              </span>
            </div>
          </div>

          <div className="commentary-text">
            {isLoading && (
              <div className="commentary-loading">
                <div className="loading-spinner"></div>
                <p>Generating personalized commentary with private AI...</p>

                {/* Progress indicator */}
                <div className="loading-progress">
                  <div className="progress-steps">
                    <div className={`progress-step ${loadingPhase === 'query' ? 'active' : 'completed'}`}>
                      <span className="step-icon">{loadingPhase !== 'query' ? '✓' : '○'}</span>
                      <span className="step-label">Query Results</span>
                    </div>
                    <div className={`progress-step ${loadingPhase === 'metadata' ? 'active' : ['token', 'llm', 'done'].includes(loadingPhase) ? 'completed' : ''}`}>
                      <span className="step-icon">{['token', 'llm', 'done'].includes(loadingPhase) ? '✓' : '○'}</span>
                      <span className="step-label">Study Metadata</span>
                    </div>
                    <div className={`progress-step ${loadingPhase === 'token' ? 'active' : ['llm', 'done'].includes(loadingPhase) ? 'completed' : ''}`}>
                      <span className="step-icon">{['llm', 'done'].includes(loadingPhase) ? '✓' : '○'}</span>
                      <span className="step-label">Secure Token</span>
                    </div>
                    <div className={`progress-step ${loadingPhase === 'llm' ? 'active' : loadingPhase === 'done' ? 'completed' : ''}`}>
                      <span className="step-icon">{loadingPhase === 'done' ? '✓' : '○'}</span>
                      <span className="step-label">LLM Analysis</span>
                    </div>
                  </div>
                </div>

                {delegationStatus && (
                  <p className="loading-subtext delegation-status">
                    {delegationStatus}
                    {resultsCount > 0 && loadingPhase === 'query' && (
                      <span className="results-count"> ({resultsCount.toLocaleString()} total results)</span>
                    )}
                  </p>
                )}
                {!delegationStatus && (
                  <p className="loading-subtext">
                    Your data is processed securely in a Trusted Execution Environment
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="commentary-error">
                <p className="error-message">❌ {error}</p>
                <button className="retry-button" onClick={handleRetry}>
                  Try Again
                </button>
              </div>
            )}

            {!isLoading && !error && commentary && (
              <div className="commentary-content">
                {studyMetadata && (
                  <StudyQualityIndicators metadata={studyMetadata} />
                )}

                {/* Analysis Metadata */}
                <div className="analysis-metadata">
                  <div className="metadata-item">
                    <span className="metadata-icon">📊</span>
                    <span className="metadata-label">Results analyzed:</span>
                    <span className="metadata-value">{analysisResultsCount.toLocaleString()}</span>
                  </div>
                  <div className="metadata-item">
                    <span className="metadata-icon">👤</span>
                    <span className="metadata-label">Personalization:</span>
                    <span className="metadata-value">{hasCustomization ? 'Enabled' : 'Not configured'}</span>
                  </div>
                  <div className="metadata-item metadata-note">
                    <span className="metadata-icon">🔍</span>
                    <span className="metadata-note-text">
                      Results selected using semantic relevance matching (check browser console for details)
                    </span>
                  </div>
                </div>

                <div className="commentary-section">
                  <div className="commentary-header">
                    <span className="commentary-icon">🤖</span>
                    <h3>LLM-Generated Interpretation</h3>
                  </div>
                  <div
                    className="commentary-body"
                    dangerouslySetInnerHTML={{ __html: commentary }}
                  />
                </div>

                {/* Collapsible list of studies used in analysis */}
                {analysisResults.length > 0 && (
                  <details className="studies-used-section">
                    <summary className="studies-used-summary">
                      <span className="summary-icon">📚</span>
                      <span className="summary-text">
                        View all {analysisResults.length} studies used in this analysis
                      </span>
                      <span className="summary-arrow">▼</span>
                    </summary>
                    <div className="studies-used-list">
                      {analysisResults.map((result, index) => (
                        <div key={result.studyId} className="study-item">
                          <div className="study-item-header">
                            <span className="study-number">{index + 1}.</span>
                            <span className="study-trait">{result.traitName}</span>
                            {index === 0 && (
                              <span className="current-badge">Current</span>
                            )}
                          </div>
                          <div className="study-item-details">
                            <div className="study-detail">
                              <span className="detail-label">Study:</span>
                              <span className="detail-value">{result.studyTitle}</span>
                            </div>
                            <div className="study-detail">
                              <span className="detail-label">Your genotype:</span>
                              <span className="detail-value">{result.userGenotype}</span>
                            </div>
                            <div className="study-detail">
                              <span className="detail-label">Risk score:</span>
                              <span className={`detail-value risk-${result.riskLevel}`}>
                                {formatRiskScore(result.riskScore, result.riskLevel, result.effectType)} ({result.riskLevel})
                              </span>
                            </div>
                            <div className="study-detail">
                              <span className="detail-label">SNP:</span>
                              <span className="detail-value">{result.matchedSnp}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="ai-limitations-disclaimer">
                  <div className="disclaimer-icon">⚠️</div>
                  <div>
                    <strong>LLM-Generated Content Limitations</strong>
                    <p>
                      This commentary is generated by an LLM model and may not fully account for study
                      limitations, your specific ancestry, the latest research, or individual medical factors.
                      It should be used for educational purposes only. Always consult a healthcare professional
                      or genetic counselor for personalized medical interpretation and advice.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          {!isLoading && !error && commentary && (
            <button className="disclaimer-button primary" onClick={handlePrint}>
              🖨️ Print Analysis
            </button>
          )}
          <button className="disclaimer-button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  // Render modal in a portal at document body level to ensure it appears fixed to viewport
  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
