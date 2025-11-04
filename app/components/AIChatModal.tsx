"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { SavedResult } from "@/lib/results-manager";
import NilAIConsentModal from "./NilAIConsentModal";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import { callLLM, getLLMDescription } from "@/lib/llm-client";

type AIChatModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

const CONSENT_STORAGE_KEY = "nilai_ai_chat_consent_accepted";
const SIMILAR_STUDIES_LIMIT = 1000; // Fetch top 1000 similar studies to maximize matches
const MAX_CONTEXT_RESULTS = 500; // Include up to 500 matched user results in context

export default function AIChatModal({ isOpen, onClose }: AIChatModalProps) {
  const resultsContext = useResults();
  const { getTopResultsByRelevance } = resultsContext;
  const { customization, status: customizationStatus } = useCustomization();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [showPersonalizationPrompt, setShowPersonalizationPrompt] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Check if user has previously consented
    if (typeof window !== "undefined") {
      const consent = localStorage.getItem(CONSENT_STORAGE_KEY);
      setHasConsent(consent === "true");
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Check if personalization is not set or locked
      if (customizationStatus === 'not-set' || customizationStatus === 'locked') {
        setShowPersonalizationPrompt(true);
      } else if (!hasConsent) {
        setShowConsentModal(true);
      }
    }
  }, [isOpen, customizationStatus, hasConsent]);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // Focus input when modal opens
    if (isOpen && !showConsentModal && !showPersonalizationPrompt) {
      inputRef.current?.focus();
    }
  }, [isOpen, showConsentModal, showPersonalizationPrompt]);

  const handleConsentAccept = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(CONSENT_STORAGE_KEY, "true");
      setHasConsent(true);
      setShowConsentModal(false);
    }
  };

  const handleConsentDecline = () => {
    setShowConsentModal(false);
    onClose();
  };

  const handlePersonalizationPromptClose = () => {
    setShowPersonalizationPrompt(false);
    onClose();
  };

  const handlePersonalizationPromptContinue = () => {
    setShowPersonalizationPrompt(false);
    if (!hasConsent) {
      setShowConsentModal(true);
    }
  };

  const formatRiskScore = (score: number, level: string, effectType?: 'OR' | 'beta'): string => {
    if (level === 'neutral') return effectType === 'beta' ? 'baseline' : '1.0x';
    if (effectType === 'beta') {
      return `β=${score >= 0 ? '+' : ''}${score.toFixed(3)} units`;
    }
    return `${score.toFixed(2)}x`;
  };

  const handleSendMessage = async () => {
    const query = inputValue.trim();
    if (!query) return;

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: query,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setError(null);

    try {
      // Get relevant results using RAG
      console.log(`[AI Chat] Finding relevant results for query: "${query}"`);
      const relevantResults = await getTopResultsByRelevance(query, MAX_CONTEXT_RESULTS);
      console.log(`[AI Chat] Found ${relevantResults.length} relevant results`);

      // Use centralized LLM client

      // Build context from ALL relevant results (no slicing - use everything we found)
      const contextResults = relevantResults
        .map((r: SavedResult, idx: number) =>
          `${idx + 1}. ${r.traitName} (${r.studyTitle}):
   - Your genotype: ${r.userGenotype}
   - Risk allele: ${r.riskAllele}
   - Risk score: ${formatRiskScore(r.riskScore, r.riskLevel, r.effectType)} (${r.riskLevel})
   - SNP: ${r.matchedSnp}`
        )
        .join('\n\n');

      console.log(`[AI Chat] Including ${relevantResults.length} results in LLM context`);

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

Consider how this user's background may affect their risk profile and the applicability of these study findings.`;
        }
      }

      // Build conversation history
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Create system prompt
      const systemPrompt = `You are a helpful genetic counselor AI assistant. You're chatting with a user about their personal genetic results from GWAS (Genome-Wide Association Studies).

IMPORTANT CONTEXT:
- The user has uploaded their DNA file and analyzed it against thousands of GWAS studies
- They have ${resultsContext.savedResults.length.toLocaleString()} total results in memory
- You will be provided with the top ${relevantResults.length} most relevant results for each query based on semantic similarity${userContext}

YOUR MOST RELEVANT RESULTS FOR THIS QUERY:
${contextResults}

IMPORTANT GUIDELINES:
1. This is for educational and entertainment purposes only - NOT medical advice
2. GWAS results show statistical associations, not deterministic outcomes
3. Genetic risk is just one factor among many (lifestyle, environment, other genes)
4. Always encourage consulting healthcare professionals for medical interpretation
5. Be conversational and helpful, but maintain appropriate disclaimers
6. Focus on the results most relevant to their specific question
7. If asked about traits not in their results, let them know they should run the analysis first

Keep your responses concise (200-400 words), conversational, and accessible to someone without a scientific background.`;

      // Make request using centralized client
      const response = await callLLM([
        {
          role: "system",
          content: systemPrompt
        },
        ...conversationHistory.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content
        })),
        {
          role: "user",
          content: query
        }
      ], {
        maxTokens: 800,
        temperature: 0.7,
      });

      const assistantContent = response.content;

      if (!assistantContent) {
        throw new Error("No response generated from AI");
      }

      // Add assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      console.error('[AI Chat] Error:', err);
      const errorMessage = err instanceof Error ? err.message : "Failed to get response";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setError(null);
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
                For the best AI chat experience, we recommend {customizationStatus === 'not-set' ? 'setting up' : 'unlocking'} your personalization information.
              </p>
              <p>
                Personalized chat provides more relevant insights based on your ancestry, medical history, and demographics.
              </p>
              {customizationStatus === 'locked' && (
                <p className="consent-disclaimer">
                  <strong>How to unlock:</strong> Click the "🔒 Personalize" button in the menu bar and enter your password.
                </p>
              )}
              {customizationStatus === 'not-set' && (
                <p className="consent-disclaimer">
                  <strong>How to set up:</strong> Click the "⚙️ Personalize" button in the menu bar to enter your information.
                </p>
              )}
              <p className="consent-disclaimer">
                You can also continue without personalization, but responses will be less tailored to your background.
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
        className="modal-dialog ai-chat-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="chat-header">
            <h2>🤖 AI Chat: Your Genetic Results</h2>
            <p className="powered-by">
              {getLLMDescription()}
            </p>
          </div>

          <div className="chat-info">
            <span>💬 Ask questions about your {resultsContext.savedResults.length.toLocaleString()} genetic results</span>
            {messages.length > 0 && (
              <button className="clear-chat-button" onClick={handleClearChat}>
                Clear Chat
              </button>
            )}
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <h3>Welcome to AI Chat!</h3>
                <p>Ask me anything about your genetic results. For example:</p>
                <ul>
                  <li>"What are my highest risk factors?"</li>
                  <li>"Tell me about my cardiovascular health results"</li>
                  <li>"Do I have any protective variants for diabetes?"</li>
                  <li>"What traits should I pay attention to?"</li>
                </ul>
                <p className="chat-disclaimer">
                  ⚠️ This is for educational purposes only. Always consult healthcare professionals for medical advice.
                </p>
              </div>
            )}

            {messages.map((message, idx) => (
              <div key={idx} className={`chat-message ${message.role}`}>
                <div className="message-icon">
                  {message.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className="message-content">
                  <div className="message-text">{message.content}</div>
                  <div className="message-time">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="chat-message assistant">
                <div className="message-icon">🤖</div>
                <div className="message-content">
                  <div className="message-text typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="chat-error">
                <p>❌ {error}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Ask a question about your genetic results..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={isLoading}
            />
            <button
              className="chat-send-button"
              onClick={handleSendMessage}
              disabled={isLoading || !inputValue.trim()}
            >
              {isLoading ? '⏳' : '➤'} Send
            </button>
          </div>

          <div className="chat-footer-disclaimer">
            ⚠️ AI-generated content may contain errors. This is not medical advice.
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

  // Render modal in a portal at document body level
  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
