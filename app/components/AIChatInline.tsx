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

const FOLLOWUP_SUGGESTIONS = [
  "Give me film, TV and music recommendations based on these results!",
  "Is there anything fun in the results?",
  "Tell me more about the science of my results.",
  "Any supplements or vitamins I should consider?",
  "How should I adjust my diet and lifestyle?"
];

export default function AIChatInline() {
  const resultsContext = useResults();
  const { getTopResultsByRelevance } = resultsContext;
  const { customization, status: customizationStatus } = useCustomization();

  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [showPersonalizationPrompt, setShowPersonalizationPrompt] = useState(false);
  const [expandedMessageIndex, setExpandedMessageIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Determine if this is the first message or a follow-up
  const isFirstMessage = messages.length === 0;

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
    } else if (customizationStatus === 'unlocked') {
      setShowPersonalizationPrompt(false);
    }
  }, [customizationStatus]);

  // Removed auto-scroll so user doesn't have to scroll up to read responses

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

      // Only include context for the FIRST message, not follow-ups
      const shouldIncludeContext = messages.length === 0;

      if (shouldIncludeContext) {
        setLoadingStatus("🔍 Searching your results for relevant traits...");
        console.log(`[AI Chat] Finding relevant results for query: "${query}"`);
        relevantResults = await getTopResultsByRelevance(query, MAX_CONTEXT_RESULTS);
        console.log(`[AI Chat] Found ${relevantResults.length} relevant results`);
      } else {
        console.log(`[AI Chat] Follow-up question - skipping RAG context search`);
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

      setLoadingStatus(`🤖 Analyzing ${relevantResults.length} traits with AI...`);

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
        if (customization.diet) {
          const dietLabel = customization.diet === 'regular' ? 'Regular diet (no restrictions)' :
                           customization.diet.charAt(0).toUpperCase() + customization.diet.slice(1) + ' diet';
          parts.push(`Dietary preferences: ${dietLabel}`);
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

Consider how this user's background, lifestyle factors (smoking, alcohol, diet), and current medications may affect their risk profile and the applicability of these study findings.`;
        }
      }

      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const systemPrompt = `You are an expert genetic counselor AI assistant providing personalized, holistic insights about GWAS results. You are powered by Nillion's nilAI using the gpt-oss-20b model in a secure TEE (Trusted Execution Environment).

IMPORTANT CONTEXT:
- The user has uploaded their DNA file and analyzed it against thousands of GWAS studies
- They have ${resultsContext.savedResults.length.toLocaleString()} total results in memory
- You will be provided with the top ${relevantResults.length} most relevant results for each query based on semantic similarity
- CONFIDENTIAL USER INFO (DO NOT restate this in your response - the user already knows it):${userContext}

YOUR MOST RELEVANT RESULTS FOR THIS QUERY:
${contextResults}

USER'S SPECIFIC QUESTION:
"${query}"

⚠️ CRITICAL - STAY ON TOPIC:
- Answer ONLY the specific trait/condition the user asked about in their question
- Do NOT discuss other traits or conditions from the RAG context unless directly relevant to their question
- If they ask about "heart disease", focus ONLY on cardiovascular traits - ignore diabetes, cancer, etc.
- If they ask about "diabetes", focus ONLY on metabolic/diabetes traits - ignore heart, cancer, etc.
- If this is a follow-up question, continue the conversation about the SAME topic from previous messages
- Do NOT use the RAG context to go off on tangents about unrelated health topics
- The RAG context is provided for reference, but answer ONLY what the user specifically asked about

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
❌ DO NOT restate the user's personal information (age, ethnicity, medical history, smoking, alcohol, diet, etc.) - they already know it

✅ INSTEAD, synthesize findings into THEMES and PATTERNS:
- Group related variants into biological themes (e.g., "Cardiovascular Protection", "Metabolic Risk", "Inflammatory Response")
- Describe the OVERALL pattern across multiple variants (e.g., "You have 8 protective variants and 3 risk variants for heart disease, suggesting...")
- Focus on the BIG PICTURE and what the collection of findings means together
- Mention specific genes/pathways only when illustrating a broader point

PERSONALIZED HOLISTIC ADVICE FRAMEWORK:
1. Synthesize ALL findings into a coherent story about their health landscape
2. Explain how their genetic profile interacts with their background factors (without restating what those factors are)
3. Identify both strengths (protective factors) and areas to monitor (risk factors)
4. Connect different body systems (e.g., how cardiovascular + metabolic + inflammatory factors relate)
5. Provide specific, actionable recommendations tailored to THEIR situation

⚠️ CRITICAL GWAS LIMITATIONS & MEDICAL RECOMMENDATIONS:

UNDERSTANDING GWAS LIMITATIONS:
- GWAS studies show STATISTICAL ASSOCIATIONS, not direct causation
- These are POPULATION-LEVEL findings - individual risk varies dramatically
- Genetic variants explain only a SMALL FRACTION of disease risk (typically 5-30%)
- Environment, lifestyle, and chance play MUCH LARGER roles than genetics
- This app is for EDUCATIONAL PURPOSES ONLY - not clinical diagnosis
- Results should NEVER be used to make medical decisions without professional consultation

MEDICAL REFERRAL THRESHOLD - EXTREMELY HIGH BAR:
- Focus 95% of recommendations on lifestyle, diet, exercise, sleep, stress management, and self-monitoring
- ONLY suggest medical consultation if MULTIPLE high-risk variants + family history + existing symptoms align
- NEVER routinely say "consult a genetic counselor" or "see your doctor" or "get tested"
- Do NOT recommend medical tests, lab work, or screening unless findings are TRULY exceptional (e.g., multiple high-risk variants for serious hereditary conditions)
- Remember: We want to REDUCE burden on healthcare system, not increase it with worried-well patients
- Empower users with actionable self-care steps they can implement immediately
- Frame genetics as informative guidance for optimization, not deterministic outcomes requiring intervention

WHEN IN DOUBT: Recommend lifestyle changes and self-monitoring. Do NOT refer to medical professionals.

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

  const handlePrintChat = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // Convert markdown to HTML for each message
    const chatContent = messages.map(m => {
      let content = m.content;

      if (m.role === 'assistant') {
        // Basic markdown to HTML conversion for printing
        content = content
          // Headers
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^# (.*$)/gim, '<h1>$1</h1>')
          // Bold
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/__([^_]+)__/g, '<strong>$1</strong>')
          // Italic
          .replace(/\*([^*]+)\*/g, '<em>$1</em>')
          .replace(/_([^_]+)_/g, '<em>$1</em>')
          // Lists
          .replace(/^\* (.+)$/gim, '<li>$1</li>')
          .replace(/^- (.+)$/gim, '<li>$1</li>')
          .replace(/^\d+\. (.+)$/gim, '<li>$1</li>')
          // Line breaks
          .replace(/\n\n/g, '</p><p>')
          .replace(/\n/g, '<br>');

        // Wrap consecutive list items in ul tags
        content = content.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/g, '<ul>$1</ul>');

        // Wrap in paragraph if not already wrapped
        if (!content.startsWith('<h') && !content.startsWith('<ul') && !content.startsWith('<p>')) {
          content = '<p>' + content + '</p>';
        }
      } else {
        content = content.replace(/\n/g, '<br>');
      }

      return `
        <div style="margin: 1.5rem 0; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; page-break-inside: avoid;">
          <div style="font-weight: bold; margin-bottom: 0.75rem; color: ${m.role === 'user' ? '#3B82F6' : '#10B981'};">
            ${m.role === 'user' ? '👤 You' : '🤖 AI Assistant (gpt-oss-20b via Nillion nilAI)'}
          </div>
          <div style="line-height: 1.6;">${content}</div>
          <div style="font-size: 0.8rem; color: #666; margin-top: 0.75rem; border-top: 1px solid #eee; padding-top: 0.5rem;">
            ${m.timestamp.toLocaleString()}
          </div>
        </div>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>AI Chat - Genetic Results</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              padding: 2rem;
              max-width: 800px;
              margin: 0 auto;
              color: #333;
            }
            h1 {
              color: #111;
              border-bottom: 3px solid #3B82F6;
              padding-bottom: 0.75rem;
              margin-bottom: 1rem;
            }
            h2 {
              color: #222;
              margin-top: 1.5rem;
              margin-bottom: 0.75rem;
              font-size: 1.4rem;
            }
            h3 {
              color: #333;
              margin-top: 1.25rem;
              margin-bottom: 0.5rem;
              font-size: 1.2rem;
            }
            p {
              margin: 0.5rem 0;
              line-height: 1.6;
            }
            ul, ol {
              margin: 0.75rem 0;
              padding-left: 2rem;
            }
            li {
              margin: 0.4rem 0;
              line-height: 1.5;
            }
            strong {
              color: #111;
              font-weight: 600;
            }
            .disclaimer {
              background: #FEF3C7;
              border: 2px solid #F59E0B;
              border-radius: 8px;
              padding: 1rem;
              margin: 1.5rem 0;
            }
            @media print {
              body { padding: 1rem; }
              @page { margin: 1.5cm; }
            }
          </style>
        </head>
        <body>
          <h1>🤖 AI Chat: Your Genetic Results</h1>
          <p style="color: #666; margin-bottom: 1rem;">
            Chat session from ${new Date().toLocaleString()}<br>
            Powered by Nillion nilAI (gpt-oss-20b) in a secure TEE
          </p>
          <div class="disclaimer">
            <strong>⚠️ Important Disclaimer:</strong> This chat is for educational purposes only.
            GWAS results show statistical associations, not deterministic outcomes.
            Always consult healthcare professionals for medical decisions.
          </div>
          ${chatContent}
          <div style="margin-top: 3rem; padding-top: 1rem; border-top: 2px solid #ddd; color: #666; font-size: 0.9rem; text-align: center;">
            Generated by GWASifier • For Educational Purposes Only
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
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
            🛡️ Powered by <a href="https://nillion.com" target="_blank" rel="noopener noreferrer">Nillion nilAI</a> using <strong>gpt-oss-20b</strong> model in TEE (Trusted Execution Environment) -
            Your data never leaves the secure enclave
          </p>
        </div>

        <div className="chat-info">
          <div className="chat-info-left">
            <span>💬 Ask questions about your {mounted ? resultsContext.savedResults.length.toLocaleString() : '...'} genetic results</span>
          </div>
          {messages.length > 0 && (
            <div className="chat-actions">
              <button className="chat-action-button" onClick={handlePrintChat}>
                🖨️ Print
              </button>
              <button className="chat-action-button" onClick={handleClearChat}>
                🗑️ Clear
              </button>
            </div>
          )}
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <h3>Welcome to AI Chat!</h3>

              {mounted && resultsContext.savedResults.length < 1000 && (
                <div className="chat-warning">
                  <p><strong>⚠️ Limited Results ({resultsContext.savedResults.length} studies)</strong></p>
                  <p>
                    You currently have fewer than 1,000 analyzed results. For the best AI chat experience,
                    we recommend running "Run All" to analyze your DNA against all available studies.
                  </p>
                  <p>This will give the AI more comprehensive data to provide personalized insights.</p>
                </div>
              )}

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
                  <>
                    <button
                      className="copy-button"
                      onClick={() => handleCopyMessage(message.content)}
                      title="Copy to clipboard"
                    >
                      📋 Copy
                    </button>
                    {idx === messages.length - 1 && !isLoading && (
                      <div className="followup-suggestions">
                        <div className="followup-header">💡 Try asking:</div>
                        <div className="followup-buttons">
                          {FOLLOWUP_SUGGESTIONS.map((suggestion, sidx) => (
                            <button
                              key={sidx}
                              className="followup-button"
                              onClick={() => handleExampleClick(suggestion)}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
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
          <div className="chat-input-controls">
            {isFirstMessage ? (
              <div className="rag-info">
                ✓ Will search relevant traits for context
              </div>
            ) : (
              <div className="rag-info-followup">
                💬 Follow-up question (no RAG)
              </div>
            )}
            <button
              className="chat-send-button"
              onClick={handleSendMessage}
              disabled={isLoading || !inputValue.trim()}
            >
              {isLoading ? '⏳' : '➤'} Send
            </button>
          </div>
        </div>

        <div className="chat-footer-disclaimer">
          ⚠️ AI-generated content may contain errors. This is not medical advice.
        </div>
      </div>
    </>
  );
}
