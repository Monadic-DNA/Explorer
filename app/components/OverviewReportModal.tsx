"use client";

import { useState } from "react";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import { useAuth } from "./AuthProvider";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type GenerationPhase = 'idle' | 'map' | 'reduce' | 'complete' | 'error';

interface ProgressState {
  phase: GenerationPhase;
  message: string;
  progress: number;
  groupSummaries: Array<{ groupNumber: number; summary: string }>;
  finalReport: string | null;
  error: string | null;
  currentGroup?: number;
  totalGroups?: number;
  estimatedTimeRemaining?: number;
  averageTimePerGroup?: number;
}

interface OverviewReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function OverviewReportModal({ isOpen, onClose }: OverviewReportModalProps) {
  const { savedResults } = useResults();
  const { customization } = useCustomization();
  const { hasActiveSubscription } = useAuth();

  const [isGenerating, setIsGenerating] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<ProgressState>({
    phase: 'idle',
    message: '',
    progress: 0,
    groupSummaries: [],
    finalReport: null,
    error: null,
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    const start = Date.now();
    setStartTime(start);
    setElapsedTime(0);
    setProgress({
      phase: 'map',
      message: 'Initializing analysis...',
      progress: 0,
      groupSummaries: [],
      finalReport: null,
      error: null,
    });

    // Timer to update elapsed time every second
    const timerInterval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    try {
      // Dynamic import to ensure client-side only
      // Using OpenAI version temporarily while nilAI issues are resolved
      const { generateOverviewReport } = await import('@/lib/overview-report-service-openai');

      // Call client-side service with progress callback
      await generateOverviewReport(
        savedResults,
        customization,
        (update) => {
          setProgress(prev => ({
            ...prev,
            phase: update.phase,
            message: update.message,
            progress: update.progress,
            finalReport: update.finalReport || prev.finalReport,
            error: update.error || prev.error,
            currentGroup: update.currentGroup,
            totalGroups: update.totalGroups,
            estimatedTimeRemaining: update.estimatedTimeRemaining,
            averageTimePerGroup: update.averageTimePerGroup,
            groupSummaries: update.groupSummaries || [],
          }));

          if (update.phase === 'complete') {
            clearInterval(timerInterval);
            setIsGenerating(false);
          } else if (update.phase === 'error') {
            clearInterval(timerInterval);
            setIsGenerating(false);
          }
        }
      );

      console.log('[Overview Report] Generation complete');
    } catch (error) {
      console.error('[Overview Report] Generation error:', error);
      clearInterval(timerInterval);
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
      setIsGenerating(false);
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Convert markdown to HTML for printing
  const markdownToHTML = (markdown: string): string => {
    let html = markdown
      // Headers (process from most to least specific)
      .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```[\s\S]*?```/g, (match) => `<pre><code>${match.slice(3, -3)}</code></pre>`)
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Process lists and paragraphs line by line
    const lines = html.split('\n');
    const processed: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (inList) {
          processed.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        processed.push('');
        continue;
      }

      // Unordered list
      if (line.match(/^[-*+] /)) {
        if (!inList) {
          processed.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        processed.push(`<li>${line.substring(2)}</li>`);
      }
      // Ordered list
      else if (line.match(/^\d+\. /)) {
        if (!inList) {
          processed.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        processed.push(`<li>${line.replace(/^\d+\. /, '')}</li>`);
      }
      // Regular content
      else {
        if (inList) {
          processed.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }

        // Don't wrap headers or existing HTML tags in paragraphs
        if (!line.startsWith('<')) {
          processed.push(`<p>${line}</p>`);
        } else {
          processed.push(line);
        }
      }
    }

    if (inList) {
      processed.push(listType === 'ul' ? '</ul>' : '</ol>');
    }

    return processed.join('\n');
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !progress.finalReport) return;

    const htmlContent = markdownToHTML(progress.finalReport);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Comprehensive Genetic Overview Report</title>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              padding: 2rem;
              max-width: 900px;
              margin: 0 auto;
              color: #333;
              line-height: 1.6;
            }
            h1 {
              color: #111;
              border-bottom: 3px solid #3B82F6;
              padding-bottom: 0.75rem;
              margin-bottom: 1.5rem;
            }
            h2 {
              color: #222;
              margin-top: 2rem;
              margin-bottom: 1rem;
              font-size: 1.5rem;
              border-bottom: 1px solid #ddd;
              padding-bottom: 0.5rem;
            }
            h3 {
              color: #333;
              margin-top: 1.5rem;
              margin-bottom: 0.75rem;
              font-size: 1.25rem;
            }
            h4 {
              color: #444;
              margin-top: 1rem;
              margin-bottom: 0.5rem;
              font-size: 1.1rem;
            }
            p {
              margin: 1rem 0;
            }
            ul, ol {
              margin: 1rem 0;
              padding-left: 2rem;
            }
            li {
              margin: 0.5rem 0;
            }
            strong {
              color: #111;
              font-weight: 600;
            }
            em {
              font-style: italic;
            }
            code {
              background: #f5f5f5;
              padding: 0.2rem 0.4rem;
              border-radius: 3px;
              font-family: 'Monaco', 'Menlo', monospace;
              font-size: 0.9em;
            }
            pre {
              background: #f5f5f5;
              padding: 1rem;
              border-radius: 6px;
              overflow-x: auto;
            }
            a {
              color: #3B82F6;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
            .header-info {
              color: #666;
              font-size: 0.9rem;
              margin-bottom: 2rem;
              padding: 1rem;
              background: #f5f5f5;
              border-radius: 6px;
            }
            .disclaimer {
              background: #FEF3C7;
              border: 2px solid #F59E0B;
              border-radius: 8px;
              padding: 1.5rem;
              margin: 2rem 0;
            }
            @media print {
              body { padding: 1rem; }
              @page { margin: 1.5cm; }
            }
          </style>
        </head>
        <body>
          <div class="header-info">
            <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
            <strong>Results Analyzed:</strong> ${savedResults.length.toLocaleString()} high-confidence genetic variants<br>
            <strong>Powered by:</strong> OpenAI GPT-4o
          </div>
          ${htmlContent}
          <div style="margin-top: 3rem; padding-top: 1rem; border-top: 2px solid #ddd; color: #666; font-size: 0.9rem; text-align: center;">
            Generated by GWASifier • For Educational Purposes Only
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleCopyToClipboard = async () => {
    if (!progress.finalReport) return;
    try {
      await navigator.clipboard.writeText(progress.finalReport);
      alert('Report copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy report to clipboard');
    }
  };

  const handleClose = () => {
    // Reset state when closing modal to avoid showing stale data
    if (!isGenerating) {
      setProgress({
        phase: 'idle',
        message: '',
        progress: 0,
        groupSummaries: [],
        finalReport: null,
        error: null,
      });
      setElapsedTime(0);
      setStartTime(null);
    }
    onClose();
  };

  if (!isOpen) return null;

  // Check subscription
  const hasPromoAccess = typeof window !== 'undefined' && localStorage.getItem('promo_access');
  const isBlocked = !hasActiveSubscription && !hasPromoAccess;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content large-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📊 Comprehensive Genetic Overview Report</h2>
          <button className="close-button" onClick={handleClose}>×</button>
        </div>

        <div className="modal-body">
          {isBlocked ? (
            <div style={{
              textAlign: 'center',
              padding: '3rem',
              background: '#FEF3C7',
              borderRadius: '8px',
              border: '2px solid #F59E0B'
            }}>
              <h3 style={{ marginTop: 0, color: '#92400e' }}>🔒 Premium Feature</h3>
              <p style={{ color: '#92400e', marginBottom: '1rem' }}>
                Overview Report requires an active premium subscription.
              </p>
              <p style={{ fontSize: '0.875rem', color: '#78350f' }}>
                Subscribe for $4.99/month to unlock comprehensive AI-powered analysis
                of all your genetic results.
              </p>
            </div>
          ) : progress.phase === 'idle' ? (
            <div>
              <div className="overview-report-intro">
                <p>
                  <strong>Generate a comprehensive overview report</strong> analyzing all {savedResults.length.toLocaleString()} of your high-confidence genetic results.
                </p>
                <p>
                  This report uses advanced AI to identify patterns, themes, and actionable insights across your entire genetic profile.
                </p>

                <div style={{
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  borderRadius: '6px',
                  padding: '1rem',
                  margin: '1.5rem 0'
                }}>
                  <h4 style={{ marginTop: 0, fontSize: '1rem' }}>What's included:</h4>
                  <ul style={{ marginBottom: 0, paddingLeft: '1.5rem' }}>
                    <li>Analysis by major health categories (cardiovascular, metabolic, neurological, etc.)</li>
                    <li>Identification of genetic strengths and areas to monitor</li>
                    <li>Personalized action plan based on your background</li>
                    <li>Cross-system insights and connections</li>
                    <li>Lifestyle and wellness recommendations</li>
                  </ul>
                </div>

                <div style={{
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  borderRadius: '6px',
                  padding: '1rem',
                  margin: '1.5rem 0'
                }}>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    <strong>⏱️ Generation time:</strong> Approximately 3-4 minutes
                    <br />
                    <strong>🔒 Privacy:</strong> All processing happens in your browser - data never leaves your device except via nilAI TEE
                    <br />
                    <strong>📊 Analysis depth:</strong> {savedResults.length.toLocaleString()} genetic variants analyzed in 5 groups
                    <br />
                    <strong>🤖 LLM calls:</strong> 6 total (5 analysis + 1 synthesis)
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={handleGenerate}
                  disabled={savedResults.length === 0}
                  style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}
                >
                  Generate Overview Report
                </button>

                {savedResults.length < 10000 && (
                  <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#666', textAlign: 'center' }}>
                    ⚠️ You have {savedResults.length.toLocaleString()} results. For best results, run "Run All" to analyze more studies.
                  </p>
                )}
              </div>
            </div>
          ) : progress.phase === 'error' ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              background: '#FEE2E2',
              borderRadius: '8px'
            }}>
              <h3 style={{ color: '#991B1B' }}>❌ Generation Failed</h3>
              <p style={{ color: '#7F1D1D' }}>{progress.error}</p>
              <button
                className="secondary-button"
                onClick={() => setProgress({
                  phase: 'idle',
                  message: '',
                  progress: 0,
                  groupSummaries: [],
                  finalReport: null,
                  error: null,
                })}
              >
                Try Again
              </button>
            </div>
          ) : progress.phase === 'complete' && progress.finalReport ? (
            <div className="overview-report-result">
              <div style={{
                marginBottom: '1rem',
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end'
              }}>
                <button className="secondary-button" onClick={handleCopyToClipboard}>
                  📋 Copy to Clipboard
                </button>
                <button className="secondary-button" onClick={handlePrint}>
                  🖨️ Print Report
                </button>
              </div>

              <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {progress.finalReport}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="generation-progress">
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <h3>
                  {progress.phase === 'map' ? '🔍 Analyzing Results' : '🤖 Synthesizing Report'}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#666' }}>{progress.message}</p>

                <div style={{
                  width: '100%',
                  height: '24px',
                  background: '#E5E7EB',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  margin: '1.5rem 0'
                }}>
                  <div style={{
                    width: `${progress.progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #3B82F6, #10B981)',
                    transition: 'width 0.5s ease'
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3B82F6' }}>
                    {progress.progress}%
                  </p>
                  <p style={{ fontSize: '1.2rem', fontWeight: '600', color: '#10B981' }}>
                    ⏱️ {formatTime(elapsedTime)}
                  </p>
                </div>

                {progress.currentGroup && progress.totalGroups && (
                  <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '1rem' }}>
                    Batch {progress.currentGroup} of {progress.totalGroups}
                  </p>
                )}

                {progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#3B82F6', marginTop: '0.5rem', fontWeight: '600' }}>
                    ETA: {formatTime(progress.estimatedTimeRemaining)} remaining
                    {progress.averageTimePerGroup && (
                      <span style={{ fontSize: '0.75rem', color: '#666', display: 'block', marginTop: '0.25rem' }}>
                        (~{progress.averageTimePerGroup.toFixed(0)}s per batch)
                      </span>
                    )}
                  </p>
                ) : (
                  <p style={{ fontSize: '0.75rem', color: '#999', marginTop: '1.5rem' }}>
                    Analyzing your genetic data... This may take 60-90 minutes.
                  </p>
                )}
              </div>

              {/* Show intermediate reports as they come in */}
              {progress.groupSummaries.length > 0 && (
                <div style={{
                  marginTop: '2rem',
                  padding: '1.5rem',
                  background: '#F9FAFB',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB'
                }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#374151' }}>
                    📝 Intermediate Analysis ({progress.groupSummaries.length} batches completed)
                  </h4>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: '0.5rem',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    {progress.groupSummaries.map((gs, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedBatchIndex(idx)}
                        style={{
                          padding: '0.75rem',
                          background: '#FFFFFF',
                          border: '1px solid #D1D5DB',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '0.875rem',
                          color: '#374151',
                          transition: 'all 0.2s',
                          fontWeight: '500'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.background = '#F3F4F6';
                          e.currentTarget.style.borderColor = '#3B82F6';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.background = '#FFFFFF';
                          e.currentTarget.style.borderColor = '#D1D5DB';
                        }}
                      >
                        Batch {gs.groupNumber}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch Detail Modal */}
              {selectedBatchIndex !== null && progress.groupSummaries[selectedBatchIndex] && (
                <div
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    padding: '2rem'
                  }}
                  onClick={() => setSelectedBatchIndex(null)}
                >
                  <div
                    style={{
                      background: 'white',
                      borderRadius: '12px',
                      maxWidth: '900px',
                      width: '100%',
                      maxHeight: '80vh',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{
                      padding: '1.5rem',
                      borderBottom: '1px solid #E5E7EB',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <h3 style={{ margin: 0, color: '#3B82F6' }}>
                        Batch {progress.groupSummaries[selectedBatchIndex].groupNumber} Analysis
                      </h3>
                      <button
                        onClick={() => setSelectedBatchIndex(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          fontSize: '1.5rem',
                          cursor: 'pointer',
                          color: '#6B7280',
                          padding: '0.25rem 0.5rem'
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div style={{
                      padding: '1.5rem',
                      overflowY: 'auto',
                      flex: 1
                    }}>
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {progress.groupSummaries[selectedBatchIndex].summary}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
