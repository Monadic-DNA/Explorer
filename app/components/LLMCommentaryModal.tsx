"use client";

import { useEffect, useState } from "react";
import { SavedResult } from "@/lib/results-manager";
import {NilaiOpenAIClient, AuthType, NilAuthInstance} from "@nillion/nilai-ts";
import NilAIConsentModal from "./NilAIConsentModal";
import StudyQualityIndicators from "./StudyQualityIndicators";
import { useResults } from "./ResultsContext";

type LLMCommentaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentResult: SavedResult;
  allResults: SavedResult[]; // Deprecated - will use SQL query instead
};

const CONSENT_STORAGE_KEY = "nilai_ai_consent_accepted";

export default function LLMCommentaryModal({
  isOpen,
  onClose,
  currentResult,
  allResults, // Deprecated parameter
}: LLMCommentaryModalProps) {
  const { getTopResultsByEffect, savedResults } = useResults();
  const [commentary, setCommentary] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delegationStatus, setDelegationStatus] = useState<string>("");
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [studyMetadata, setStudyMetadata] = useState<any>(null);
  const [loadingPhase, setLoadingPhase] = useState<'query' | 'metadata' | 'token' | 'ai' | 'done'>('query');
  const [resultsCount, setResultsCount] = useState<number>(0);

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
      // Check consent before proceeding
      if (!hasConsent) {
        console.log('[LLMCommentaryModal] Showing consent modal');
        setShowConsentModal(true);
      } else {
        console.log('[LLMCommentaryModal] Starting fetchCommentary');
        // Call fetchCommentary inline to avoid closure issues
        (async () => {
          console.log('[fetchCommentary] Starting...');
          setIsLoading(true);
          setError(null);
          setCommentary("");
          setDelegationStatus("");
          setStudyMetadata(null);
          setLoadingPhase('query');

          try {
            // Phase 1: Query database for relevant results
            const totalResults = savedResults.length;
            console.log('[fetchCommentary] Total results:', totalResults);
            setResultsCount(totalResults);
            setLoadingPhase('query');
            setDelegationStatus(`Querying ${totalResults.toLocaleString()} results...`);

            // Yield to UI to show loading state
            await new Promise(resolve => setTimeout(resolve, 50));

            console.log(`[fetchCommentary] Fetching top 499 results from ${totalResults} total using SQL query...`);
            const startFilter = Date.now();

            const topResults = await getTopResultsByEffect(499, currentResult.gwasId);
            console.log('[fetchCommentary] Got top results:', topResults.length);

            // Add current result at the top
            const resultsForContext = [currentResult, ...topResults];

            const filterTime = Date.now() - startFilter;
            console.log(`Fetched top 500 results in ${filterTime}ms using indexed SQL query`);

            setDelegationStatus(`✓ Selected ${resultsForContext.length} most significant results (${filterTime}ms)`);

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

            // Phase 3: Initialize NilAI client and get secure token
            setLoadingPhase('token');
            setDelegationStatus("Initializing secure AI connection...");
            await new Promise(resolve => setTimeout(resolve, 50));

            // Initialize NilAI client with delegation token authentication
            const client = new NilaiOpenAIClient({
              baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
              authType: AuthType.DELEGATION_TOKEN,
              nilauthInstance: NilAuthInstance.PRODUCTION,
            });

            // Get delegation request from client
            const delegationRequest = client.getDelegationRequest();

            setDelegationStatus("Requesting delegation token from server...");

            // Request delegation token from server
            const tokenResponse = await fetch("/api/nilai-delegation", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ delegationRequest }),
            });

            if (!tokenResponse.ok) {
              const errorData = await tokenResponse.json();
              throw new Error(errorData.error || "Failed to get delegation token");
            }

            const { delegationToken } = await tokenResponse.json();

            // Update client with delegation token
            client.updateDelegation(delegationToken);

            setDelegationStatus("✓ Secure token received — connecting to private AI...");
            await new Promise(resolve => setTimeout(resolve, 100));

            // Phase 4: Generate AI commentary
            setLoadingPhase('ai');
            setDelegationStatus("Generating AI analysis (this may take 30-60 seconds)...");

            const contextResults = resultsForContext
              .map((r: SavedResult, idx: number) =>
                `${idx + 1}. ${r.traitName} (${r.studyTitle}):
   - Your genotype: ${r.userGenotype}
   - Risk allele: ${r.riskAllele}
   - Effect size: ${r.effectSize}
   - Risk score: ${r.riskScore}x (${r.riskLevel})
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

            const prompt = `You are a genetic counselor providing educational commentary on GWAS (Genome-Wide Association Study) results.

IMPORTANT DISCLAIMERS TO INCLUDE:
1. This is for educational and entertainment purposes only
2. This is NOT medical advice and should not be used for medical decisions
3. GWAS results show statistical associations, not deterministic outcomes
4. Genetic risk is just one factor among many (lifestyle, environment, other genes)
5. Always consult healthcare professionals for medical interpretation
6. These results come from research studies and may not be clinically validated
${studyQualityContext}

CURRENT RESULT TO ANALYZE:
Trait: ${currentResult.traitName}
Study: ${currentResult.studyTitle}
Your genotype: ${currentResult.userGenotype}
Risk allele: ${currentResult.riskAllele}
Effect size: ${currentResult.effectSize}
Risk score: ${currentResult.riskScore}x (${currentResult.riskLevel})
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

            // Make request directly to NilAI (data never touches our server!)
            const response = await client.chat.completions.create({
              model: "openai/gpt-oss-20b",
              messages: [
                {
                  role: "system",
                  content: "You are a knowledgeable genetic counselor who explains GWAS results clearly and responsibly, always emphasizing appropriate disclaimers and limitations."
                },
                {
                  role: "user",
                  content: prompt
                }
              ],
              max_tokens: 1200,
              temperature: 0.7,
            });

            const commentaryText = response.choices?.[0]?.message?.content;

            if (!commentaryText) {
              throw new Error("No commentary generated from LLM");
            }

            setDelegationStatus("✓ AI analysis complete — formatting response...");
            setLoadingPhase('done');
            await new Promise(resolve => setTimeout(resolve, 50));

            // Convert markdown to plain HTML
            const processedText = commentaryText
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/__(.+?)__/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>')
              .replace(/_(.+?)_/g, '<em>$1</em>')
              .replace(/^### (.+)$/gm, '<h4>$1</h4>')
              .replace(/^## (.+)$/gm, '<h3>$1</h3>')
              .replace(/^# (.+)$/gm, '<h2>$1</h2>')
              .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
              .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
              .split('\n\n')
              .map(para => para.trim())
              .filter(para => para.length > 0)
              .map(para => {
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

            if (errorMessage.includes("API key not configured")) {
              setError("LLM commentary is not configured. The NILLION_API_KEY environment variable needs to be set.");
            }
          } finally {
            console.log('[fetchCommentary] Finally block, setting isLoading to false');
            setIsLoading(false);
          }
        })();
      }
    }
  }, [isOpen, hasConsent, savedResults, getTopResultsByEffect, currentResult]);

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
      const totalResults = savedResults.length;
      console.log('[fetchCommentary] Total results:', totalResults);
      setResultsCount(totalResults);
      setLoadingPhase('query');
      setDelegationStatus(`Querying ${totalResults.toLocaleString()} results...`);

      // Yield to UI to show loading state
      await new Promise(resolve => setTimeout(resolve, 50));

      console.log(`[fetchCommentary] Fetching top 499 results from ${totalResults} total using SQL query...`);
      const startFilter = Date.now();

      const topResults = await getTopResultsByEffect(499, currentResult.gwasId);
      console.log('[fetchCommentary] Got top results:', topResults.length);

      // Add current result at the top
      const resultsForContext = [currentResult, ...topResults];

      const filterTime = Date.now() - startFilter;
      console.log(`Fetched top 500 results in ${filterTime}ms using indexed SQL query`);

      setDelegationStatus(`✓ Selected ${resultsForContext.length} most significant results (${filterTime}ms)`);

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

      // Phase 3: Initialize NilAI client and get secure token
      setLoadingPhase('token');
      setDelegationStatus("Initializing secure AI connection...");
      await new Promise(resolve => setTimeout(resolve, 50));

      // Initialize NilAI client with delegation token authentication
      const client = new NilaiOpenAIClient({
        baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
        authType: AuthType.DELEGATION_TOKEN,
        nilauthInstance: NilAuthInstance.PRODUCTION,
      });

      // Get delegation request from client
      const delegationRequest = client.getDelegationRequest();

      setDelegationStatus("Requesting delegation token from server...");

      // Request delegation token from server
      const tokenResponse = await fetch("/api/nilai-delegation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ delegationRequest }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(errorData.error || "Failed to get delegation token");
      }

      const { delegationToken } = await tokenResponse.json();

      // Update client with delegation token
      client.updateDelegation(delegationToken);

      setDelegationStatus("✓ Secure token received — connecting to private AI...");
      await new Promise(resolve => setTimeout(resolve, 100));

      // Phase 4: Generate AI commentary
      setLoadingPhase('ai');
      setDelegationStatus("Generating AI analysis (this may take 30-60 seconds)...");

      const contextResults = resultsForContext
        .map((r: SavedResult, idx: number) =>
          `${idx + 1}. ${r.traitName} (${r.studyTitle}):
   - Your genotype: ${r.userGenotype}
   - Risk allele: ${r.riskAllele}
   - Effect size: ${r.effectSize}
   - Risk score: ${r.riskScore}x (${r.riskLevel})
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

      const prompt = `You are a genetic counselor providing educational commentary on GWAS (Genome-Wide Association Study) results.

IMPORTANT DISCLAIMERS TO INCLUDE:
1. This is for educational and entertainment purposes only
2. This is NOT medical advice and should not be used for medical decisions
3. GWAS results show statistical associations, not deterministic outcomes
4. Genetic risk is just one factor among many (lifestyle, environment, other genes)
5. Always consult healthcare professionals for medical interpretation
6. These results come from research studies and may not be clinically validated
${studyQualityContext}

CURRENT RESULT TO ANALYZE:
Trait: ${currentResult.traitName}
Study: ${currentResult.studyTitle}
Your genotype: ${currentResult.userGenotype}
Risk allele: ${currentResult.riskAllele}
Effect size: ${currentResult.effectSize}
Risk score: ${currentResult.riskScore}x (${currentResult.riskLevel})
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

      // Make request directly to NilAI (data never touches our server!)
      const response = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: "You are a knowledgeable genetic counselor who explains GWAS results clearly and responsibly, always emphasizing appropriate disclaimers and limitations."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1200, // Increased to prevent cutoff
        temperature: 0.7,
      });

      const commentaryText = response.choices?.[0]?.message?.content;

      if (!commentaryText) {
        throw new Error("No commentary generated from LLM");
      }

      setDelegationStatus("✓ AI analysis complete — formatting response...");
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

  if (!isOpen) return null;

  // If consent modal is showing, only render that
  if (showConsentModal) {
    return (
      <NilAIConsentModal
        isOpen={showConsentModal}
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
      />
    );
  }

  // Otherwise render the commentary modal
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog commentary-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <h2>🤖 AI Commentary on Your Result</h2>

          <div className="commentary-powered-by-header">
            <p className="powered-by">
              🛡️ Powered by <a href="https://nillion.com" target="_blank" rel="noopener noreferrer">Nillion nilAI</a> -
              Privacy-preserving AI in a Trusted Execution Environment
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
                <strong>Risk score:</strong> {currentResult.riskScore}x ({currentResult.riskLevel})
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
                    <div className={`progress-step ${loadingPhase === 'query' ? 'active' : loadingPhase !== 'query' ? 'completed' : ''}`}>
                      <span className="step-icon">{loadingPhase !== 'query' ? '✓' : '○'}</span>
                      <span className="step-label">Query Results</span>
                    </div>
                    <div className={`progress-step ${loadingPhase === 'metadata' ? 'active' : ['token', 'ai', 'done'].includes(loadingPhase) ? 'completed' : ''}`}>
                      <span className="step-icon">{['token', 'ai', 'done'].includes(loadingPhase) ? '✓' : '○'}</span>
                      <span className="step-label">Study Metadata</span>
                    </div>
                    <div className={`progress-step ${loadingPhase === 'token' ? 'active' : ['ai', 'done'].includes(loadingPhase) ? 'completed' : ''}`}>
                      <span className="step-icon">{['ai', 'done'].includes(loadingPhase) ? '✓' : '○'}</span>
                      <span className="step-label">Secure Token</span>
                    </div>
                    <div className={`progress-step ${loadingPhase === 'ai' ? 'active' : loadingPhase === 'done' ? 'completed' : ''}`}>
                      <span className="step-icon">{loadingPhase === 'done' ? '✓' : '○'}</span>
                      <span className="step-label">AI Analysis</span>
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
                <div className="commentary-section">
                  <div className="commentary-header">
                    <span className="commentary-icon">🤖</span>
                    <h3>AI-Generated Interpretation</h3>
                  </div>
                  <div
                    className="commentary-body"
                    dangerouslySetInnerHTML={{ __html: commentary }}
                  />
                </div>
                <div className="ai-limitations-disclaimer">
                  <div className="disclaimer-icon">⚠️</div>
                  <div>
                    <strong>AI-Generated Content Limitations</strong>
                    <p>
                      This commentary is generated by an AI model and may not fully account for study
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
          <button className="disclaimer-button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
