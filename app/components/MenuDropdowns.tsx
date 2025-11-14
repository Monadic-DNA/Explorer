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
    <div ref={dropdownRef} className="menu-dropdown">
      <div className="dropdown-content">
        <h3>My Data</h3>
        {isUploaded && genotypeData && (
          <p className="stat-display">{genotypeData.size.toLocaleString()} variants loaded</p>
        )}
        <UserDataUploadComponent />
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
    <div ref={dropdownRef} className="menu-dropdown">
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
                <FileIcon size={14} /> Load
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
                <SaveIcon size={14} /> Export
              </button>
              <button
                className="control-button clear"
                onClick={() => {
                  onClearResults();
                  onClose();
                }}
                title="Clear all saved results"
              >
                <TrashIcon size={14} /> Clear
              </button>
            </>
          )}
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
    <div ref={dropdownRef} className="menu-dropdown">
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
