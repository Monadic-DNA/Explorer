"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { callLLM } from "@/lib/llm-client";
import { useResults } from "./ResultsContext";

type NillionModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type Question = {
  id: string;
  question: string;
  type: "radio" | "scale";
  options?: string[];
};

const questions: Question[] = [
  {
    id: "blockchain",
    question: "Do you mainly trade on Solana, EVM chains, or other blockchains?",
    type: "radio",
    options: ["Solana", "EVM chains", "Other blockchains", "I don't trade"]
  },
  {
    id: "lowCap",
    question: "Do you trade assets below a 10 million market cap?",
    type: "radio",
    options: ["Yes", "No"]
  },
  {
    id: "midCap",
    question: "Do you trade assets below a 100 million market cap?",
    type: "radio",
    options: ["Yes", "No"]
  },
  {
    id: "bridge",
    question: "Do you bridge to new blockchains at launch?",
    type: "radio",
    options: ["Yes", "No", "Sometimes"]
  },
  {
    id: "selfScore",
    question: "On a scale of 1–10, how much of a degen would you say you are?",
    type: "scale"
  }
];

type StudyData = {
  study_accession: string;
  similarity: number;
  traitName?: string;
  studyTitle?: string;
  mappedGene?: string;
  matchedSnp?: string;
  userGenotype?: string;
  riskScore?: number;
  riskLevel?: string;
  effectType?: string;
};

export default function NillionModal({ isOpen, onClose }: NillionModalProps) {
  const { savedResults } = useResults();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationStep, setCalculationStep] = useState<string>('');
  const [studyCount, setStudyCount] = useState<number>(0);
  const [studies, setStudies] = useState<StudyData[]>([]);
  const [degenScore, setDegenScore] = useState<number | null>(null);
  const [reasoning, setReasoning] = useState<string>('');
  const [tradingAdvice, setTradingAdvice] = useState<string>('');
  const [showStudies, setShowStudies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasEnoughResults, setHasEnoughResults] = useState(false);

  // Check if user has at least 10,000 results
  useEffect(() => {
    setHasEnoughResults(savedResults.length >= 10000);
  }, [savedResults]);

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const allQuestionsAnswered = questions.every(q => answers[q.id]);

  // Format risk score the same way as LLM Chat
  const formatRiskScore = (score: number, level: string, effectType?: 'OR' | 'beta'): string => {
    if (level === 'neutral') return effectType === 'beta' ? 'baseline' : '1.0x';
    if (effectType === 'beta') {
      return `β=${score >= 0 ? '+' : ''}${score.toFixed(3)} units`;
    }
    return `${score.toFixed(2)}x`;
  };

  const calculateDegenScore = async () => {
    setIsCalculating(true);
    setError(null);
    setCalculationStep('Searching results for risk-related traits...');

    try {
      // Step 1: Perform semantic search for "risk appetite" traits
      const response = await fetch('/api/similar-studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'risk appetite, risk taking behavior, impulsivity, sensation seeking',
          limit: 500
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch risk appetite studies');
      }

      const data = await response.json();
      const studiesData = data.studies || [];

      // Enrich study data with details from savedResults
      // The API returns {study_accession: string, similarity: number}
      // We need to find the matching SavedResult and use its full data
      const enrichedStudies = studiesData.map((study: any) => {
        // Match using gwasId (GWAS study accession)
        const savedResult = savedResults.find(r => r.gwasId === study.study_accession);
        if (savedResult) {
          // Return the full SavedResult object with similarity added
          return {
            ...savedResult,
            similarity: study.similarity
          };
        }
        // If no match found, return minimal data
        return {
          study_accession: study.study_accession,
          similarity: study.similarity,
          traitName: study.study_accession,
          studyTitle: 'Study details not available',
          matchedSnp: 'N/A',
          userGenotype: 'N/A',
          riskLevel: 'neutral' as const
        };
      });

      setStudies(enrichedStudies);
      setStudyCount(enrichedStudies.length);

      setCalculationStep(`Found ${enrichedStudies.length} genetic studies. Analyzing risk profile...`);

      // Small delay to show the step
      await new Promise(resolve => setTimeout(resolve, 800));

      // Step 2: Use LLM to calculate genetic degen score (purely genetic, no user behavior hints)
      setCalculationStep('Calculating genetic risk appetite score...');

      const prompt = `Analyze genetic risk profile based on ${enrichedStudies.length} genetic studies related to risk-taking, impulsivity, and sensation seeking.

Provide a genetic risk score from 0.0-10.0 where:
0.0 = risk-averse, 5.0 = average, 10.0 = high risk propensity

Provide:
1. A detailed 2-3 sentence explanation of the genetic score
2. Brief, balanced trading behavior advice (1-2 sentences) considering this genetic profile

Respond ONLY with JSON:
{"geneticScore": 7.5, "reasoning": "detailed explanation", "tradingAdvice": "brief advice"}`;

      const llmResponse = await callLLM([
        { role: 'system', content: 'You are a genetics specialist.' },
        { role: 'user', content: prompt }
      ], {
        maxTokens: 500,
        temperature: 0.7,
        reasoningEffort: 'low'
      });

      // Parse LLM response
      const responseText = llmResponse.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('Failed to parse LLM response');
      }

      const result = JSON.parse(jsonMatch[0]);
      const geneticScore = result.geneticScore || result.degenScore;
      const scoreReasoning = result.reasoning || 'No reasoning provided';
      const advice = result.tradingAdvice || '';

      setCalculationStep('Complete! Displaying results...');
      await new Promise(resolve => setTimeout(resolve, 500));

      setDegenScore(geneticScore);
      setReasoning(scoreReasoning);
      setTradingAdvice(advice);

    } catch (err) {
      console.error('Error calculating degen score:', err);

      // Provide more specific error message
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
        setError('The LLM service returned an error. This might be due to API limits or model availability. Please try again or check your LLM configuration.');
      } else if (errorMessage.includes('Failed to fetch')) {
        setError('Unable to connect to the genetic database or LLM service. Please check your internet connection.');
      } else {
        setError('Failed to calculate degen score. Please try again.');
      }
    } finally {
      setIsCalculating(false);
      setCalculationStep('');
    }
  };

  const handleReset = () => {
    setAnswers({});
    setDegenScore(null);
    setReasoning('');
    setTradingAdvice('');
    setStudies([]);
    setError(null);
    setCalculationStep('');
    setStudyCount(0);
    setShowStudies(false);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog nillion-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-content">

        <div className="modal-header">
          <h2>Nillion x Monadic DNA Collab</h2>
          <p className="modal-subtitle">
            Nillion x Monadic DNA: Who's more degen - SOL traders or ETH traders?
          </p>
        </div>

        <div className="modal-body">
          {degenScore === null ? (
            <>
              {!hasEnoughResults ? (
                <div className="warning-message">
                  <h3>⚠️ Insufficient Results</h3>
                  <p>
                    You need at least <strong>10,000 results</strong> to participate in this analysis.
                    You currently have <strong>{savedResults.length.toLocaleString()}</strong> results.
                  </p>
                  <p>
                    Please use <strong>Run All</strong> under the <strong>Premium</strong> tab to generate
                    enough results first.
                  </p>
                </div>
              ) : (
                <>
                  <div className="nillion-intro">
                    <p>
                      We're collaborating with Nillion to analyze the correlation between
                      self-reported and genetic risk appetite scores!
                    </p>
                    <p>
                      Answer a few questions about your trading behavior, then we'll calculate
                      your degen score based on your genetic traits related to risk appetite.
                    </p>
                  </div>

                  <div className="questionnaire">
                {questions.map((q, index) => (
                  <div key={q.id} className="question-block">
                    <label className="question-label">
                      {index + 1}. {q.question}
                    </label>

                    {q.type === "radio" && q.options && (
                      <div className="radio-options">
                        {q.options.map(option => (
                          <label key={option} className="radio-option">
                            <input
                              type="radio"
                              name={q.id}
                              value={option}
                              checked={answers[q.id] === option}
                              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {q.type === "scale" && (
                      <div className="scale-input">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={answers[q.id] || "5"}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                          className="scale-slider"
                        />
                        <div className="scale-value">{answers[q.id] || "5"}/10</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {error && <div className="error-message">{error}</div>}

              {isCalculating && calculationStep && (
                <div className="calculation-progress">
                  <div className="progress-spinner"></div>
                  <div className="progress-text">{calculationStep}</div>
                </div>
              )}

                  <button
                    className="primary-button"
                    onClick={calculateDegenScore}
                    disabled={!allQuestionsAnswered || isCalculating}
                  >
                    {isCalculating ? 'Analyzing...' : 'Calculate My Degen Score'}
                  </button>
                </>
              )}
            </>
          ) : (
            <div className="degen-result">
              <h3>Your Crypto Degen Score</h3>
              <div className="score-display">
                <div className="score-number">{degenScore.toFixed(1)}</div>
                <div className="score-scale">out of 10</div>
              </div>

              <div className="score-comparison">
                <p><strong>Self-reported score:</strong> {answers.selfScore}/10</p>
                <p><strong>Genetic risk appetite score:</strong> {degenScore.toFixed(1)}/10</p>
                <p className="comparison-note">
                  {Math.abs(parseFloat(answers.selfScore) - degenScore) < 1.5
                    ? "Your self-assessment closely matches your genetic risk profile!"
                    : Math.abs(parseFloat(answers.selfScore) - degenScore) > 3
                    ? "Interesting! There's a significant difference between your self-perception and genetic risk appetite."
                    : "Your self-assessment is moderately aligned with your genetic risk profile."}
                </p>
              </div>

              <div className="score-explanation">
                <h4>Genetic Analysis</h4>
                <p className="reasoning-text">{reasoning}</p>
                <p className="methodology-note">
                  This is a purely genetic assessment based on {studyCount} studies - it doesn't consider your actual trading behavior,
                  only your genetic predisposition to risk-taking.
                </p>
              </div>

              {tradingAdvice && (
                <div className="trading-advice">
                  <h4>💡 Trading Considerations</h4>
                  <p>{tradingAdvice}</p>
                </div>
              )}

              {/* Collapsible studies list */}
              {studies.length > 0 && (
                <div className="studies-used">
                  <button
                    className="studies-toggle"
                    onClick={() => setShowStudies(!showStudies)}
                  >
                    {showStudies ? '▼' : '▶'} {studies.length} genetic studies used
                  </button>
                  {showStudies && (
                    <div className="studies-list">
                      {studies.slice(0, 50).map((study, idx) => (
                        <div key={idx} className="study-item">
                          <div className="study-trait">{study.traitName}</div>
                          {study.studyTitle && (
                            <div className="study-title">{study.studyTitle}</div>
                          )}
                          <div className="study-details">
                            {study.mappedGene && <span className="study-gene">Gene: {study.mappedGene}</span>}
                            <span className="study-snp">SNP: {study.matchedSnp}</span>
                            <span className="study-genotype">Your genotype: {study.userGenotype}</span>
                            {study.riskScore !== undefined && study.riskLevel && (
                              <span className="study-risk">Risk: {formatRiskScore(study.riskScore, study.riskLevel, study.effectType)}</span>
                            )}
                            <span className="study-level" data-level={study.riskLevel}>{study.riskLevel}</span>
                            {study.similarity !== undefined && (
                              <span className="study-similarity" title="Semantic relevance to risk appetite query">
                                Match: {(study.similarity * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {studies.length > 50 && (
                        <div className="study-item-note">
                          Showing top 50 of {studies.length} studies
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="follow-up-note">
                <h4>📊 Want to Explore Further?</h4>
                <p>
                  Use <strong>LLM Chat</strong> under the <strong>Premium</strong> tab to ask questions
                  about your genetic risk profile and get personalized insights.
                </p>
              </div>

              <div className="collab-note">
                <p>
                  We'll be publishing aggregate data comparing SOL vs ETH traders' self-reported
                  and genetic degen scores on social media. Stay tuned!
                </p>
              </div>

              <button className="secondary-button" onClick={handleReset}>
                Take Quiz Again
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
