"use client";

type RunAllModalProps = {
  isOpen: boolean;
  onClose: () => void;
  status: {
    phase: 'fetching' | 'downloading' | 'decompressing' | 'parsing' | 'storing' | 'analyzing' | 'embeddings' | 'complete' | 'error';
    fetchedBatches: number;
    totalStudiesFetched: number;
    totalInDatabase: number;
    matchingStudies: number;
    processedCount: number;
    totalToProcess: number;
    matchCount: number;
    startTime?: number;
    elapsedSeconds?: number;
    etaSeconds?: number;
    errorMessage?: string;
    embeddingProgress?: { current: number; total: number };
  };
};

export default function RunAllModal({ isOpen, onClose, status }: RunAllModalProps) {
  if (!isOpen) return null;

  const canClose = status.phase === 'complete' || status.phase === 'error';

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="modal-overlay" onClick={canClose ? onClose : undefined}>
      <div className="modal-content run-all-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Run All Analysis</h2>
          {canClose && (
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>

        <div className="modal-body">
          {(status.phase === 'downloading' || status.phase === 'fetching') && (
            <div className="status-section">
              <div className="status-header">
                <div className="spinner"></div>
                <h3>Downloading GWAS Catalog...</h3>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${status.totalInDatabase > 0 ? (status.totalStudiesFetched / status.totalInDatabase) * 100 : 0}%` }}
                ></div>
              </div>
              <div className="status-details">
                <p>Downloaded: <strong>{(status.totalStudiesFetched / 1024 / 1024).toFixed(1)} MB</strong> / {(status.totalInDatabase / 1024 / 1024).toFixed(1)} MB</p>
                {status.elapsedSeconds !== undefined && (
                  <p>Elapsed: <strong>{formatTime(status.elapsedSeconds)}</strong></p>
                )}
                <p className="status-hint">First-time setup - this data will be cached locally...</p>
              </div>
            </div>
          )}

          {status.phase === 'decompressing' && (
            <div className="status-section">
              <div className="status-header">
                <div className="spinner"></div>
                <h3>Decompressing Data...</h3>
              </div>
              <div className="status-details">
                <p className="status-hint">Unzipping compressed catalog file...</p>
                {status.elapsedSeconds !== undefined && (
                  <p>Elapsed: <strong>{formatTime(status.elapsedSeconds)}</strong></p>
                )}
              </div>
            </div>
          )}

          {status.phase === 'parsing' && (
            <div className="status-section">
              <div className="status-header">
                <div className="spinner"></div>
                <h3>Parsing Studies...</h3>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${status.totalInDatabase > 0 ? (status.totalStudiesFetched / status.totalInDatabase) * 100 : 0}%` }}
                ></div>
              </div>
              <div className="status-details">
                <p>Parsed: <strong>{status.totalStudiesFetched.toLocaleString()}</strong> / {status.totalInDatabase.toLocaleString()} lines</p>
                {status.elapsedSeconds !== undefined && (
                  <p>Elapsed: <strong>{formatTime(status.elapsedSeconds)}</strong></p>
                )}
              </div>
            </div>
          )}

          {status.phase === 'storing' && (
            <div className="status-section">
              <div className="status-header">
                <div className="spinner"></div>
                <h3>Storing in Browser IndexedDB...</h3>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${status.totalInDatabase > 0 ? (status.totalStudiesFetched / status.totalInDatabase) * 100 : 0}%` }}
                ></div>
              </div>
              <div className="status-details">
                <p>Stored: <strong>{status.totalStudiesFetched.toLocaleString()}</strong> / {status.totalInDatabase.toLocaleString()} studies</p>
                {status.elapsedSeconds !== undefined && (
                  <p>Elapsed: <strong>{formatTime(status.elapsedSeconds)}</strong></p>
                )}
                <p className="status-hint">Caching GWAS catalog locally for faster future analysis...</p>
              </div>
            </div>
          )}

          {status.phase === 'analyzing' && (
            <div className="status-section">
              <div className="status-header">
                <div className="spinner"></div>
                <h3>Analyzing Studies...</h3>
              </div>
              <div className="status-details">
                <p>Total studies: <strong>{status.totalInDatabase.toLocaleString()}</strong></p>
                <p>Matching your SNPs: <strong>{status.matchingStudies.toLocaleString()}</strong> analyzed ({status.matchCount.toLocaleString()} matches)</p>
                {status.elapsedSeconds !== undefined && (
                  <p>Elapsed: <strong>{formatTime(status.elapsedSeconds)}</strong></p>
                )}
                <p className="status-hint">Processing sequentially to minimize memory usage...</p>
              </div>
            </div>
          )}

          {status.phase === 'embeddings' && (
            <div className="status-section">
              <div className="status-header">
                <div className="spinner"></div>
                <h3>Generating AI Embeddings...</h3>
              </div>
              <div className="status-details">
                {status.embeddingProgress && (
                  <>
                    <p>Progress: <strong>{status.embeddingProgress.current.toLocaleString()}</strong> / <strong>{status.embeddingProgress.total.toLocaleString()}</strong> results</p>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${(status.embeddingProgress.current / status.embeddingProgress.total) * 100}%` }}
                      />
                    </div>
                  </>
                )}
                <p className="status-hint">
                  Generating semantic embeddings for AI-powered analysis. This enables intelligent
                  result selection when you use AI commentary. This is a one-time process.
                </p>
              </div>
            </div>
          )}

          {status.phase === 'complete' && (
            <div className="status-section complete">
              <div className="status-header">
                <span className="success-icon">✓</span>
                <h3>Analysis Complete!</h3>
              </div>
              <div className="status-details">
                <p>Fetched: <strong>{status.totalStudiesFetched.toLocaleString()}</strong> studies from database</p>
                <p>Analyzed: <strong>{status.matchingStudies.toLocaleString()}</strong> matching your SNPs</p>
                <p>Matches found: <strong>{status.matchCount.toLocaleString()}</strong></p>
                {status.elapsedSeconds !== undefined && (
                  <p>Total time: <strong>{formatTime(status.elapsedSeconds)}</strong></p>
                )}
                <p className="status-hint">Your results have been saved and can be viewed in the table below.</p>
              </div>
              <div className="modal-actions">
                <button className="modal-button primary" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}

          {status.phase === 'error' && (
            <div className="status-section error">
              <div className="status-header">
                <span className="error-icon">✕</span>
                <h3>Analysis Failed</h3>
              </div>
              <div className="status-details">
                <p className="error-message">{status.errorMessage || 'Unknown error occurred'}</p>
                <p className="status-hint">Partial results (if any) have been saved.</p>
              </div>
              <div className="modal-actions">
                <button className="modal-button primary" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
