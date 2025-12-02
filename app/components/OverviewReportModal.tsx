"use client";

import { useState } from "react";
import { useResults } from "./ResultsContext";
import { useCustomization } from "./CustomizationContext";
import { useAuth } from "./AuthProvider";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { trackOverviewReportGenerated } from "@/lib/analytics";

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
      const { generateOverviewReport } = await import('@/lib/overview-report-service');

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
            groupSummaries: update.groupSummaries !== undefined ? update.groupSummaries : prev.groupSummaries,
          }));

          if (update.phase === 'complete') {
            clearInterval(timerInterval);
            setIsGenerating(false);
            // Track overview report generation
            trackOverviewReportGenerated(savedResults.length);
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
    // First pass: Handle code blocks (to protect them from other processing)
    const codeBlocks: string[] = [];
    let workingText = markdown.replace(/```([\s\S]*?)```/g, (match, code) => {
      const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
      codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
      return placeholder;
    });

    // Second pass: Handle inline code (protect from bold/italic processing)
    const inlineCodes: string[] = [];
    workingText = workingText.replace(/`([^`]+)`/g, (match, code) => {
      const placeholder = `__INLINECODE_${inlineCodes.length}__`;
      inlineCodes.push(`<code>${code}</code>`);
      return placeholder;
    });

    // Third pass: Process line by line for structure (headers, lists, paragraphs)
    const lines = workingText.split('\n');
    const processed: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Empty lines
      if (!trimmedLine) {
        if (inList) {
          processed.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        processed.push('');
        continue;
      }

      // Horizontal rules
      if (trimmedLine.match(/^(---+|\*\*\*+|___+)$/)) {
        if (inList) {
          processed.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        processed.push('<hr>');
        continue;
      }

      // Headers (must be at start of line with space after #)
      if (trimmedLine.match(/^#{1,6} /)) {
        if (inList) {
          processed.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        const level = trimmedLine.match(/^(#{1,6}) /)![1].length;
        const text = trimmedLine.substring(level + 1);
        processed.push(`<h${level}>${text}</h${level}>`);
        continue;
      }

      // Unordered list items
      if (trimmedLine.match(/^[-*+] /)) {
        if (!inList || listType !== 'ul') {
          if (inList) processed.push('</ol>');
          processed.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        processed.push(`<li>${trimmedLine.substring(2)}</li>`);
        continue;
      }

      // Ordered list items
      if (trimmedLine.match(/^\d+\. /)) {
        if (!inList || listType !== 'ol') {
          if (inList) processed.push('</ul>');
          processed.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        processed.push(`<li>${trimmedLine.replace(/^\d+\. /, '')}</li>`);
        continue;
      }

      // Regular paragraphs
      if (inList) {
        processed.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = null;
      }
      processed.push(`<p>${trimmedLine}</p>`);
    }

    // Close any open lists
    if (inList) {
      processed.push(listType === 'ul' ? '</ul>' : '</ol>');
    }

    let html = processed.join('\n');

    // Fourth pass: Inline formatting (bold, italic, links)
    // Bold (must come before italic to handle ** before *)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Fifth pass: Restore code blocks and inline code
    html = html.replace(/__CODEBLOCK_(\d+)__/g, (match, index) => codeBlocks[parseInt(index)]);
    html = html.replace(/__INLINECODE_(\d+)__/g, (match, index) => inlineCodes[parseInt(index)]);

    return html;
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !progress.finalReport) return;

    // Convert markdown to HTML for both final report and batch summaries
    const finalReportHTML = markdownToHTML(progress.finalReport);

    // Append map reports to the final report
    let mapReportsHTML = '';
    if (progress.groupSummaries.length > 0) {
      mapReportsHTML = '<div style="page-break-before: always; margin-top: 3rem;"><h1>Appendix: Detailed Batch Analysis</h1>';
      mapReportsHTML += '<p style="color: #666; margin-bottom: 2rem;">The following sections contain the detailed analysis from each batch of genetic variants that were synthesized into the main report above.</p>';

      progress.groupSummaries.forEach((gs) => {
        mapReportsHTML += `<div style="margin-bottom: 3rem; padding-bottom: 2rem; border-bottom: 2px solid #E5E7EB;">`;
        mapReportsHTML += `<h2 style="color: #3B82F6;">Batch ${gs.groupNumber}</h2>`;
        mapReportsHTML += markdownToHTML(gs.summary);
        mapReportsHTML += `</div>`;
      });

      mapReportsHTML += '</div>';
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Comprehensive Genetic Overview Report - Monadic DNA Explorer</title>
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
            .report-header {
              text-align: center;
              margin-bottom: 3rem;
              padding-bottom: 2rem;
              border-bottom: 3px solid #3B82F6;
            }
            .report-header h1 {
              font-size: 2.5rem;
              color: #111;
              margin: 0 0 0.5rem 0;
              border: none;
              padding: 0;
            }
            .report-header .subtitle {
              font-size: 1.25rem;
              color: #666;
              margin: 0.5rem 0 1.5rem 0;
            }
            .report-header .tool-info {
              background: #F0F9FF;
              border: 2px solid #3B82F6;
              border-radius: 8px;
              padding: 1.5rem;
              margin: 1.5rem 0;
              text-align: left;
            }
            .report-header .tool-info h3 {
              margin-top: 0;
              color: #1E40AF;
              font-size: 1.1rem;
            }
            .report-header .tool-info p {
              margin: 0.5rem 0;
              color: #374151;
              line-height: 1.7;
            }
            h1 {
              color: #111;
              border-bottom: 3px solid #3B82F6;
              padding-bottom: 0.75rem;
              margin-top: 2rem;
              margin-bottom: 1.5rem;
              font-size: 2rem;
            }
            h2 {
              color: #222;
              margin-top: 2.5rem;
              margin-bottom: 1rem;
              font-size: 1.5rem;
              border-bottom: 2px solid #ddd;
              padding-bottom: 0.5rem;
            }
            h3 {
              color: #333;
              margin-top: 2rem;
              margin-bottom: 0.75rem;
              font-size: 1.25rem;
            }
            h4 {
              color: #444;
              margin-top: 1.5rem;
              margin-bottom: 0.5rem;
              font-size: 1.1rem;
            }
            p {
              margin: 1.25rem 0;
              line-height: 1.8;
            }
            ul, ol {
              margin: 1.25rem 0;
              padding-left: 2rem;
              line-height: 1.7;
            }
            li {
              margin: 0.75rem 0;
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
              line-height: 1.5;
            }
            pre code {
              background: none;
              padding: 0;
            }
            a {
              color: #3B82F6;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
            .metadata-box {
              color: #666;
              font-size: 0.9rem;
              margin-bottom: 2rem;
              padding: 1.5rem;
              background: #f5f5f5;
              border-radius: 8px;
              border: 1px solid #ddd;
            }
            .metadata-box strong {
              color: #333;
            }
            .disclaimer {
              background: #FEF3C7;
              border: 2px solid #F59E0B;
              border-radius: 8px;
              padding: 1.5rem;
              margin: 2rem 0;
            }
            .disclaimer h4 {
              margin-top: 0;
              color: #92400E;
            }
            .disclaimer p {
              margin: 0.5rem 0;
              color: #78350F;
            }
            hr {
              border: none;
              border-top: 2px solid #ddd;
              margin: 2rem 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 1.5rem 0;
            }
            table th {
              background: #f5f5f5;
              padding: 0.75rem;
              text-align: left;
              border: 1px solid #ddd;
              font-weight: 600;
            }
            table td {
              padding: 0.75rem;
              border: 1px solid #ddd;
            }
            table tr:nth-child(even) {
              background: #fafafa;
            }
            @media print {
              body { padding: 1rem; }
              @page { margin: 1.5cm; }
              .report-header { page-break-after: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="report-header">
            <h1>Comprehensive Genetic Overview Report</h1>
            <div class="subtitle">Generated by Monadic DNA Explorer</div>

            <div class="tool-info">
              <h3>About Monadic DNA Explorer</h3>
              <p><strong>Monadic DNA Explorer</strong> is a personal genomics analysis tool that processes publicly available GWAS (Genome-Wide Association Studies) data to generate personalized genetic insights. This report synthesizes findings from ${savedResults.length.toLocaleString()} high-confidence genetic variants that matched the user's genetic profile out of over 1 million available traits.</p>
              <p><strong>Analysis Method:</strong> This report uses a map-reduce LLM approach, where genetic data is divided into ${progress.groupSummaries.length} batches, each analyzed independently before being synthesized into comprehensive insights.</p>
              <p><strong>Data Sources:</strong> Analysis is based on peer-reviewed GWAS studies from the GWAS Catalog and other publicly available genomic databases.</p>
            </div>

            <div class="disclaimer">
              <h4>⚠️ Important Medical Disclaimer</h4>
              <p><strong>This report is for educational and informational purposes only.</strong> It is not intended to diagnose, treat, cure, or prevent any disease or medical condition.</p>
              <p>The information provided should not be used as a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of a qualified healthcare provider with any questions regarding a medical condition or genetic findings.</p>
              <p>Genetic analysis is complex and constantly evolving. Results should be interpreted by qualified medical professionals in the context of complete medical history, family history, and clinical examination.</p>
            </div>

            <div class="metadata-box">
              <strong>Report Generated:</strong> ${new Date().toLocaleString()}<br>
              <strong>Genetic Variants Analyzed:</strong> ${savedResults.length.toLocaleString()} high-confidence variants<br>
              <strong>Analysis Batches:</strong> ${progress.groupSummaries.length}<br>
              <strong>LLM Model:</strong> OpenAI GPT-4o<br>
              <strong>Tool Version:</strong> Monadic DNA Explorer (Experimental)
            </div>
          </div>

          ${finalReportHTML}
          ${mapReportsHTML}

          <div style="margin-top: 3rem; padding-top: 1.5rem; border-top: 2px solid #ddd; color: #666; font-size: 0.9rem; text-align: center;">
            <p style="margin: 0.5rem 0;"><strong>Generated by Monadic DNA Explorer</strong></p>
            <p style="margin: 0.5rem 0;">https://monadicdna.com</p>
            <p style="margin: 0.5rem 0;">For Educational Purposes Only • Not Medical Advice</p>
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
        <button className="close-button" onClick={handleClose} style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          zIndex: 10,
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          cursor: 'pointer',
          color: 'var(--text-primary)'
        }}>×</button>

        <div className="modal-body">
          {isBlocked ? (
            <div style={{
              textAlign: 'center',
              padding: '3rem',
              background: 'var(--modal-bg)',
              borderRadius: '8px',
              border: '2px solid #F59E0B'
            }}>
              <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>🔒 Premium Feature</h3>
              <p style={{ color: 'var(--text-primary)', marginBottom: '1rem' }}>
                Overview Report requires an active premium subscription.
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Subscribe for $4.99/month to unlock comprehensive LLM-powered analysis
                of all your genetic results.
              </p>
            </div>
          ) : progress.phase === 'idle' ? (
            <div style={{
              background: 'var(--modal-bg)',
              borderRadius: '8px',
              padding: '1.5rem'
            }}>
              <div className="overview-report-intro">
                <h2 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-primary)' }}>
                  📊 Comprehensive Genetic Overview Report <span style={{color: 'var(--accent-yellow)', fontSize: '0.8em'}}>(Experimental)</span>
                </h2>
                <p style={{ color: 'var(--text-primary)' }}>
                  <strong>Generate a comprehensive overview report</strong> analyzing all {savedResults.length.toLocaleString()} of your high-confidence genetic results.
                </p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  This report uses AI to identify patterns, themes, and actionable insights across your entire genetic profile.
                </p>

                <div style={{
                  borderLeft: '3px solid var(--accent-blue)',
                  paddingLeft: '1rem',
                  margin: '1.5rem 0'
                }}>
                  <h4 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1rem', color: 'var(--text-primary)' }}>What's included:</h4>
                  <ul style={{ marginBottom: 0, marginTop: 0, paddingLeft: '1.5rem', color: 'var(--text-primary)' }}>
                    <li>Analysis by major categories (traits, conditions, physiological factors, etc.)</li>
                    <li>Identification of genetic strengths and areas to monitor</li>
                    <li>Personalized action plan based on your background</li>
                    <li>Cross-system insights and connections</li>
                    <li>Lifestyle and wellness recommendations</li>
                  </ul>
                </div>

                <div style={{
                  borderLeft: '3px solid var(--accent-yellow)',
                  paddingLeft: '1rem',
                  margin: '1.5rem 0'
                }}>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    <strong>⚠️ Experimental Feature:</strong> This feature uses a map/reduce approach where your data is split into batches, each analyzed separately by an LLM, then synthesized into a final report. Generation time is highly variable and difficult to predict. This process involves multiple LLM calls and may take several minutes to complete.
                  </p>
                </div>

                <div style={{
                  borderLeft: '3px solid var(--accent-green)',
                  paddingLeft: '1rem',
                  margin: '1.5rem 0'
                }}>
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    <strong>🔒 Privacy:</strong> Your genetic data is processed securely through nilAI's confidential computing environment. Analysis requests are encrypted and processed in a trusted execution environment that prevents any access to your data.
                  </p>
                  <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    <strong>📊 Analysis depth:</strong> {savedResults.length.toLocaleString()} genetic variants
                  </p>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    <strong>🤖 LLM calls:</strong> {(() => {
                      const highConfResults = savedResults.filter(r =>
                        (typeof r.sampleSize === 'number' ? r.sampleSize : 0) >= 5000
                      );
                      const batchCount = Math.max(4, Math.min(32, Math.ceil(highConfResults.length / 3000)));
                      return `${batchCount + 1} total (${batchCount} batch analyses + 1 synthesis)`;
                    })()}
                  </p>
                </div>

                <button
                  className="primary-button"
                  onClick={handleGenerate}
                  disabled={savedResults.length === 0}
                  style={{ width: '100%', padding: '1rem', fontSize: '1rem', marginTop: '1.5rem' }}
                >
                  Generate Overview Report
                </button>

                {savedResults.length < 10000 && (
                  <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
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
            <div style={{
              background: 'var(--modal-bg)',
              borderRadius: '8px',
              padding: '1.5rem'
            }}>
              <div style={{
                marginBottom: '1.5rem',
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

              <div style={{
                background: 'var(--surface-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '1rem',
                marginBottom: '2rem',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)'
              }}>
                <strong style={{ color: 'var(--text-primary)' }}>Generated:</strong> {new Date().toLocaleString()}<br/>
                <strong style={{ color: 'var(--text-primary)' }}>Results Analyzed:</strong> {savedResults.length.toLocaleString()} high-confidence genetic variants<br/>
                <strong style={{ color: 'var(--text-primary)' }}>Batches Processed:</strong> {progress.groupSummaries.length}
              </div>

              <div className="markdown-content" style={{
                color: 'var(--text-primary)',
                lineHeight: '1.7'
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {progress.finalReport}
                </ReactMarkdown>
              </div>

              {progress.groupSummaries.length > 0 && (
                <div style={{
                  marginTop: '3rem',
                  paddingTop: '2rem',
                  borderTop: '2px solid var(--border-color)'
                }}>
                  <h2 style={{
                    color: 'var(--text-primary)',
                    marginTop: 0,
                    marginBottom: '1rem',
                    fontSize: '1.5rem',
                    borderBottom: '2px solid var(--accent-blue)',
                    paddingBottom: '0.5rem'
                  }}>
                    Appendix: Detailed Batch Analysis
                  </h2>
                  <p style={{
                    color: 'var(--text-secondary)',
                    marginBottom: '2rem',
                    fontSize: '0.95rem'
                  }}>
                    The following sections contain the detailed analysis from each batch of genetic variants that were synthesized into the main report above.
                  </p>

                  {progress.groupSummaries.map((gs, idx) => (
                    <div key={idx} style={{
                      marginBottom: '3rem',
                      paddingBottom: '2rem',
                      borderBottom: idx < progress.groupSummaries.length - 1 ? `1px solid var(--border-color)` : 'none'
                    }}>
                      <h3 style={{
                        color: 'var(--accent-blue)',
                        marginTop: 0,
                        marginBottom: '1rem',
                        fontSize: '1.25rem'
                      }}>
                        Batch {gs.groupNumber}
                      </h3>
                      <div className="markdown-content" style={{
                        color: 'var(--text-primary)',
                        lineHeight: '1.7'
                      }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {gs.summary}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{
                marginTop: '3rem',
                paddingTop: '1rem',
                borderTop: '2px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                textAlign: 'center'
              }}>
                Generated by GWASifier • For Educational Purposes Only
              </div>
            </div>
          ) : (
            <div style={{
              background: 'var(--modal-bg)',
              borderRadius: '8px',
              padding: '1.5rem'
            }}>
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <h2 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  {progress.phase === 'map' ? '🔍 Analyzing Results' : '🤖 Synthesizing Report'}
                </h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{progress.message}</p>

                <div style={{
                  width: '100%',
                  height: '24px',
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  margin: '1.5rem 0'
                }}>
                  <div style={{
                    width: `${progress.progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-green))',
                    transition: 'width 0.5s ease'
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                    {progress.progress}%
                  </p>
                  <p style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--accent-green)' }}>
                    ⏱️ {formatTime(elapsedTime)}
                  </p>
                </div>

                {progress.currentGroup && progress.totalGroups && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '1rem' }}>
                    Batch {progress.currentGroup} of {progress.totalGroups}
                  </p>
                )}

                {progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--accent-blue)', marginTop: '0.5rem', fontWeight: '600' }}>
                    ETA: {formatTime(progress.estimatedTimeRemaining)} remaining
                    {progress.averageTimePerGroup && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                        (~{progress.averageTimePerGroup.toFixed(0)}s per batch)
                      </span>
                    )}
                  </p>
                ) : (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
                    Analyzing your genetic data... This may take up to 10 minutes.
                  </p>
                )}

                {/* Show intermediate reports as they come in */}
                {progress.groupSummaries.length > 0 && (
                  <div style={{
                    marginTop: '2rem',
                    paddingTop: '1.5rem',
                    borderTop: '1px solid var(--border-color)'
                  }}>
                    <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>
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
                            background: 'var(--surface-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            color: 'var(--text-primary)',
                            transition: 'all 0.2s',
                            fontWeight: '500'
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.background = 'var(--border-color)';
                            e.currentTarget.style.borderColor = 'var(--accent-blue)';
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.background = 'var(--surface-bg)';
                            e.currentTarget.style.borderColor = 'var(--border-color)';
                          }}
                        >
                          Batch {gs.groupNumber}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

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
