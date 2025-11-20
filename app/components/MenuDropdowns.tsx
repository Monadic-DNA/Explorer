"use client";

import { useEffect, useRef } from "react";
import { FileIcon, SaveIcon, TrashIcon, MessageIcon, ClockIcon } from "./Icons";

// My Data Dropdown
export function MyDataDropdown({
  isOpen,
  onClose,
  isUploaded,
  genotypeData,
  UserDataUploadComponent,
}: {
  isOpen: boolean;
  onClose: () => void;
  isUploaded: boolean;
  genotypeData: { size: number } | null;
  UserDataUploadComponent: React.ComponentType;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={dropdownRef} className="menu-dropdown my-data-dropdown">
      <div className="dropdown-content">
        <h3>My Data</h3>

        {isUploaded && genotypeData && (
          <div className="data-loaded-section">
            <p className="stat-display">✓ {genotypeData.size.toLocaleString()} variants loaded</p>
            <p className="data-status-message">Your genetic data is ready to explore!</p>
          </div>
        )}

        <div className="upload-section">
          <UserDataUploadComponent />
        </div>

        {!isUploaded && (
          <div className="data-info-section">
            <div className="info-block">
              <h4>🧬 Why Upload Your DNA?</h4>
              <p>Plug in your raw DNA data to see which genetic variants you carry and explore thousands of traits from the GWAS Catalog.</p>
            </div>

            <div className="info-block">
              <h4>🔒 Privacy & Security</h4>
              <p>Your DNA file never leaves your device. All processing happens locally in your browser. We never store or transmit your genetic data.</p>
            </div>

            <div className="info-block">
              <h4>📁 Supported Formats</h4>
              <p><strong>23andMe:</strong> .txt file<br />
              <strong>AncestryDNA:</strong> .txt file<br />
              <strong>Monadic DNA:</strong> .txt, .csv, .tsv</p>
              <p className="file-limit">Maximum file size: 50MB</p>
            </div>

            <div className="info-block">
              <h4>📥 How to Get Your Data</h4>
              <p>Follow our <a
                href="https://monadicdna.com/guide"
                target="_blank"
                rel="noopener noreferrer"
                className="guide-link"
              >step-by-step guide</a> to download your raw data from 23andMe or AncestryDNA.</p>
              <p style={{ marginTop: '0.5rem' }}>Don't have genetic data yet? <a
                href="https://docs.google.com/forms/d/e/1FAIpQLSdHFDpsyU0t6PlaXEkbHX-pwF_y7icuPJeOHyGHMDpe11XigQ/viewform?usp=sharing&ouid=117844628488835974298"
                target="_blank"
                rel="noopener noreferrer"
                className="guide-link"
              >Get sequenced by Monadic DNA</a>.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Results Dropdown
export function ResultsDropdown({
  isOpen,
  onClose,
  savedResults,
  onLoadFromFile,
  onSaveToFile,
  onClearResults,
  isLoadingFile,
}: {
  isOpen: boolean;
  onClose: () => void;
  savedResults: unknown[];
  onLoadFromFile: () => void;
  onSaveToFile: () => void;
  onClearResults: () => void;
  isLoadingFile: boolean;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={dropdownRef} className="menu-dropdown results-dropdown">
      <div className="dropdown-content">
        <h3>Results</h3>

        {savedResults.length > 0 && (
          <p className="stat-display">
            {savedResults.length} result{savedResults.length !== 1 ? "s" : ""} cached
          </p>
        )}

        <div className="dropdown-actions">
          <button
            className="control-button load"
            onClick={() => {
              onLoadFromFile();
              onClose();
            }}
            disabled={isLoadingFile}
            title="Load results from a file"
          >
            {isLoadingFile ? (
              <>
                <ClockIcon size={14} /> Loading...
              </>
            ) : (
              <>
                <FileIcon size={14} /> Load from File
              </>
            )}
          </button>
          {savedResults.length > 0 && (
            <>
              <button
                className="control-button save"
                onClick={() => {
                  onSaveToFile();
                  onClose();
                }}
                title="Export your results to a TSV file"
              >
                <SaveIcon size={14} /> Export to File
              </button>
              <button
                className="control-button clear"
                onClick={() => {
                  onClearResults();
                  onClose();
                }}
                title="Clear all saved results"
              >
                <TrashIcon size={14} /> Clear All
              </button>
            </>
          )}
        </div>

        <div className="results-info-section">
          <div className="info-block">
            <h4>📊 What are Results?</h4>
            <p>Results are the genetic traits you've analyzed from the GWAS Catalog. Each result shows which variants you carry and how they relate to specific traits.</p>
          </div>

          <div className="info-block">
            <h4>💾 Managing Your Results</h4>
            <p><strong>Load:</strong> Import previously exported results from a TSV file</p>
            <p><strong>Export:</strong> Save your results to a TSV file for backup or sharing</p>
            <p><strong>Clear:</strong> Remove all cached results from your browser</p>
          </div>

          <div className="info-block">
            <h4>🔒 Privacy</h4>
            <p>Results are stored locally in your browser only. When you export, the file is saved directly to your device. Your data never touches our servers.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Cache Dropdown
export function CacheDropdown({
  isOpen,
  onClose,
  cacheInfo,
  onClearCache,
}: {
  isOpen: boolean;
  onClose: () => void;
  cacheInfo: { studies: number; sizeMB: number } | null;
  onClearCache: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={dropdownRef} className="menu-dropdown cache-dropdown">
      <div className="dropdown-content">
        <h3>Cache</h3>
        {cacheInfo ? (
          <>
            <p className="stat-display">
              {cacheInfo.studies.toLocaleString()} studies cached ({cacheInfo.sizeMB} MB)
            </p>
            <div className="dropdown-actions">
              <button
                className="control-button clear"
                onClick={() => {
                  onClearCache();
                  onClose();
                }}
                title="Clear locally cached GWAS catalog data"
              >
                <TrashIcon size={14} /> Clear Cache
              </button>
            </div>
          </>
        ) : (
          <p className="stat-display">No cached data</p>
        )}

        <div className="cache-info-section">
          <div className="info-block">
            <h4>🗄️ What is the Cache?</h4>
            <p>The cache stores GWAS Catalog data locally in your browser. This includes study information and genetic associations that are downloaded when you run analyses.</p>
          </div>

          <div className="info-block">
            <h4>⚡ Why Cache Data?</h4>
            <p>Caching dramatically speeds up the app by avoiding repeated downloads of the same GWAS studies. Once cached, trait analyses run much faster.</p>
          </div>

          <div className="info-block">
            <h4>🔄 When to Clear Cache</h4>
            <p><strong>Clear if:</strong> You're running low on disk space or want to force fresh downloads of GWAS data.</p>
            <p><strong>Note:</strong> Clearing the cache won't delete your results. Data will be re-downloaded automatically the next time you run analyses.</p>
          </div>

          <div className="info-block">
            <h4>🔒 Privacy</h4>
            <p>Cached data contains only public GWAS Catalog information, not your personal genetic data. It's stored locally in your browser's IndexedDB.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Help Dropdown
export function HelpDropdown({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={dropdownRef} className="menu-dropdown">
      <div className="dropdown-content">
        <h3>Help & Feedback</h3>
        <div className="dropdown-actions">
          <a
            href="https://recherche.discourse.group/c/public/monadic-dna/30"
            target="_blank"
            rel="noopener noreferrer"
            className="control-button"
            onClick={onClose}
            title="Join fellow explorers - share your feedback on our forum"
          >
            <MessageIcon size={14} /> Community Forum
          </a>
          <a
            href="https://monadicdna.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="control-button"
            onClick={onClose}
            title="Visit Monadic DNA website"
          >
            Documentation
          </a>
        </div>
      </div>
    </div>
  );
}
