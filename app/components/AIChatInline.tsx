"use client";

import { useEffect, useState, useRef } from "react";
import { SavedResult } from "@/lib/results-manager";
import { NilaiOpenAIClient, AuthType, NilAuthInstance } from "@nillion/nilai-ts";
import NilAIConsentModal from "./NilAIConsentModal";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  studiesUsed?: SavedResult[];
};

const CONSENT_STORAGE_KEY = "nilai_ai_chat_consent_accepted";
const SIMILAR_STUDIES_LIMIT = 1000;
const MAX_CONTEXT_RESULTS = 500;

const EXAMPLE_QUESTIONS = [
  "What are my highest risk factors?",
  "Tell me about my cardiovascular health results",
  "Do I have any protective variants for diabetes?",
  "What traits should I pay attention to?"
];

export default function AIChatInline() {
  const resultsContext = useResults();
  const { getTopResultsByRelevance } = resultsContext;
  const { customization, status: customizationStatus } = useCustomization();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [showPersonalizationPrompt, setShowPersonalizationPrompt] = useState(false);
  const [expandedMessageIndex, setExpandedMessageIndex] = useState<number | null>(null);
  const [includeContext, setIncludeContext] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const consent = localStorage.getItem(CONSENT_STORAGE_KEY);
      setHasConsent(consent === "true");
    }
  }, []);

  useEffect(() => {
    // Check if personalization is not set or locked on mount only
    if (customizationStatus === 'not-set' || customizationStatus === 'locked') {
      setShowPersonalizationPrompt(true);
    }
  }, [customizationStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!showConsentModal && !showPersonalizationPrompt) {
      inputRef.current?.focus();
    }
  }, [showConsentModal, showPersonalizationPrompt]);

  const handleConsentAccept = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(CONSENT_STORAGE_KEY, "true");
      setHasConsent(true);
      setShowConsentModal(false);
    }
  };

  const handleConsentDecline = () => {
    setShowConsentModal(false);
  };

  const handlePersonalizationPromptContinue = () => {
    setShowPersonalizationPrompt(false);
  };

  const handleExampleClick = (question: string) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      // Could add a toast notification here
      console.log('Message copied to clipboard');
    } catch (err) {
      console.error('Failed to copy message:', err);
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

    // Check consent before sending first message
    if (!hasConsent) {
      setShowConsentModal(true);
      return;
    }

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
      let relevantResults: SavedResult[] = [];

      if (includeContext) {
        setLoadingStatus("🔍 Searching your results for relevant studies...");
        console.log(`[AI Chat] Finding relevant results for query: "${query}"`);
        relevantResults = await getTopResultsByRelevance(query, MAX_CONTEXT_RESULTS);
        console.log(`[AI Chat] Found ${relevantResults.length} relevant results`);
      } else {
        console.log(`[AI Chat] Skipping context search (user disabled)`);
      }

      setLoadingStatus("🔐 Retrieving secure AI token...");
      const client = new NilaiOpenAIClient({
        baseURL: 'https://nilai-f910.nillion.network/nuc/v1/',
        authType: AuthType.DELEGATION_TOKEN,
        nilauthInstance: NilAuthInstance.PRODUCTION,
      });

      const delegationRequest = client.getDelegationRequest();

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
      client.updateDelegation(delegationToken);

      setLoadingStatus(`🤖 Analyzing ${relevantResults.length} studies with AI...`);

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
        if (customization.smokingHistory) {
          const smokingLabel = customization.smokingHistory === 'still-smoking' ? 'Currently smoking' :
                               customization.smokingHistory === 'past-smoker' ? 'Former smoker' :
                               'Never smoked';
          parts.push(`Smoking history: ${smokingLabel}`);
        }
        if (customization.alcoholUse) {
          const alcoholLabel = customization.alcoholUse.charAt(0).toUpperCase() + customization.alcoholUse.slice(1);
          parts.push(`Alcohol use: ${alcoholLabel}`);
        }
        if (customization.medications && customization.medications.length > 0) {
          parts.push(`Current medications/supplements: ${customization.medications.join(', ')}`);
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

Consider how this user's background, lifestyle factors (smoking, alcohol), and current medications may affect their risk profile and the applicability of these study findings.`;
        }
      }

      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const systemPrompt = `You are an expert genetic counselor AI assistant providing personalized, holistic insights about GWAS results.

IMPORTANT CONTEXT:
- The user has uploaded their DNA file and analyzed it against thousands of GWAS studies
- They have ${resultsContext.savedResults.length.toLocaleString()} total results in memory
- You will be provided with the top ${relevantResults.length} most relevant results for each query based on semantic similarity${userContext}

YOUR MOST RELEVANT RESULTS FOR THIS QUERY:
${contextResults}

CRITICAL INSTRUCTIONS - COMPLETE RESPONSES:
1. You MUST ALWAYS finish your complete response - NEVER stop mid-sentence, mid-paragraph, or mid-section
2. If you create sections or lists, you MUST complete ALL sections fully
3. Do NOT truncate your response - always provide a proper conclusion with next steps
4. If running low on space, wrap up your current section properly and provide a brief conclusion
5. Every response MUST have a clear ending with actionable takeaways

HOW TO PRESENT FINDINGS - AVOID STUDY-BY-STUDY LISTS:
❌ DO NOT create tables listing individual SNPs/studies one by one
❌ DO NOT list rs numbers with individual interpretations
❌ DO NOT organize findings by individual genetic variants

✅ INSTEAD, synthesize findings into THEMES and PATTERNS:
- Group related variants into biological themes (e.g., "Cardiovascular Protection", "Metabolic Risk", "Inflammatory Response")
- Describe the OVERALL pattern across multiple variants (e.g., "You have 8 protective variants and 3 risk variants for heart disease, suggesting...")
- Focus on the BIG PICTURE and what the collection of findings means together
- Mention specific genes/pathways only when illustrating a broader point

PERSONALIZED HOLISTIC ADVICE FRAMEWORK:
1. Acknowledge the user's specific background (ethnicity, age, medical history)
2. Synthesize ALL findings into a coherent story about their health landscape
3. Explain how their genetic profile interacts with their background and conditions
4. Identify both strengths (protective factors) and areas to monitor (risk factors)
5. Connect different body systems (e.g., how cardiovascular + metabolic + inflammatory factors relate)
6. Provide specific, actionable recommendations tailored to THEIR situation

RESPONSE STRUCTURE (Complete Each Section Fully):

**Section 1: Personalized Overview** (2-3 sentences)
- Acknowledge their background and what you'll cover

**Section 2: Overall Genetic Landscape** (3-4 paragraphs)
- Describe the big picture patterns you see across their results
- Group findings into 2-4 major themes (e.g., cardiovascular, metabolic, inflammatory)
- For each theme, explain the overall trend and what it means for them specifically
- Connect how different themes relate to each other

**Section 3: What This Means for You Specifically** (2-3 paragraphs)
- Synthesize how these findings interact with their ethnicity, age, and medical history
- Balance protective factors with risk areas
- Provide context about how genetics fits with lifestyle and environment

**Section 4: Personalized Action Steps** (4-6 specific recommendations)
- Concrete, actionable recommendations based on their results AND background
- Prioritize actions that address their specific risk profile
- Include both prevention and monitoring strategies
- Make recommendations specific to their situation (not generic)

**Section 5: Next Steps** (2-3 sentences)
- Empowering conclusion with clear path forward
- Reminder to discuss with healthcare providers

RESPONSE REQUIREMENTS:
- Target 700-1000 words for comprehensive coverage
- Use headers (##) and bold text for organization
- Use bullet points for recommendations
- NO tables of individual SNPs - synthesize into themes instead
- Write in an engaging, conversational tone
- Explain concepts in plain language
- This is educational, NOT medical advice
- COMPLETE your full response - never stop abruptly

Remember: You have plenty of space. Use ALL of it to provide a complete, thorough, personalized analysis. Do not rush. Do not truncate.`;

      console.log('=== AI CHAT PROMPT ===');
      console.log('System Prompt:', systemPrompt);
      console.log('User Query:', query);
      console.log('Relevant Results Count:', relevantResults.length);
      console.log('=====================');

      const response = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...conversationHistory,
          {
            role: "user",
            content: query
          }
        ],
        max_tokens: 3000,
        temperature: 0.7,
      });

      const assistantContent = response.choices?.[0]?.message?.content;

      if (!assistantContent) {
        throw new Error("No response generated from AI");
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date(),
        studiesUsed: relevantResults
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

  if (showPersonalizationPrompt) {
    return (
      <div className="ai-chat-inline-blocked">
        <div className="blocked-message">
          <h2>📋 Personalization Recommended</h2>
          <p>
            For the best AI chat experience, we recommend {customizationStatus === 'not-set' ? 'setting up' : 'unlocking'} your personalization information.
          </p>
          <p>
            Personalized chat provides more relevant insights based on your ancestry, medical history, and demographics.
          </p>
          {customizationStatus === 'locked' && (
            <p>
              <strong>How to unlock:</strong> Click the "🔒 Personalize" button in the menu bar and enter your password.
            </p>
          )}
          {customizationStatus === 'not-set' && (
            <p>
              <strong>How to set up:</strong> Click the "⚙️ Personalize" button in the menu bar to enter your information.
            </p>
          )}
          <button
            className="primary-button"
            onClick={handlePersonalizationPromptContinue}
          >
            Continue Without Personalization
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showConsentModal && (
        <NilAIConsentModal
          isOpen={showConsentModal}
          onAccept={handleConsentAccept}
          onDecline={handleConsentDecline}
        />
      )}
      <div className="ai-chat-inline">
        <div className="chat-header">
          <h2>🤖 AI Chat: Your Genetic Results</h2>
          <p className="powered-by">
            🛡️ Powered by <a href="https://nillion.com" target="_blank" rel="noopener noreferrer">Nillion nilAI</a> with TEE (Trusted Execution Environment) -
            Your data never leaves the secure enclave
          </p>
        </div>

        <div className="chat-info">
          <div className="chat-info-left">
            <span>💬 Ask questions about your {resultsContext.savedResults.length.toLocaleString()} genetic results</span>
            <label className="context-toggle">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
              />
              <span>Include relevant results in prompts</span>
            </label>
          </div>
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
              <ul className="example-questions">
                {EXAMPLE_QUESTIONS.map((question, idx) => (
                  <li key={idx} onClick={() => handleExampleClick(question)}>
                    {question}
                  </li>
                ))}
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
                <div className="message-text">
                  {message.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
                {message.role === 'assistant' && (
                  <button
                    className="copy-button"
                    onClick={() => handleCopyMessage(message.content)}
                    title="Copy to clipboard"
                  >
                    📋 Copy
                  </button>
                )}
                {message.role === 'assistant' && message.studiesUsed && message.studiesUsed.length > 0 && (
                  <div className="studies-used">
                    <button
                      className="studies-toggle"
                      onClick={() => setExpandedMessageIndex(expandedMessageIndex === idx ? null : idx)}
                    >
                      {expandedMessageIndex === idx ? '▼' : '▶'} {message.studiesUsed.length} studies used
                    </button>
                    {expandedMessageIndex === idx && (
                      <div className="studies-list">
                        {message.studiesUsed.map((study, studyIdx) => (
                          <div key={studyIdx} className="study-item">
                            <div className="study-trait">{study.traitName}</div>
                            <div className="study-details">
                              <span className="study-genotype">Your genotype: {study.userGenotype}</span>
                              <span className="study-risk">Risk: {formatRiskScore(study.riskScore, study.riskLevel, study.effectType)}</span>
                              <span className="study-level" data-level={study.riskLevel}>{study.riskLevel}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                <div className="message-text">
                  <div className="loading-status">{loadingStatus}</div>
                  <div className="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
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
    </>
  );
}
