"use client";

import { useState, useRef, createContext, useContext, useCallback, useEffect } from "react";
import { GenotypeData, detectAndParseGenotypeFile, validateFileSize, validateFileFormat } from "@/lib/genotype-parser";
import { calculateFileHash } from "@/lib/file-hash";
import {
  trackFileCleared,
  trackGenotypeFileLoaded,
  trackGenotypeFileUploadFailed,
  trackGenotypeFileUploadStarted,
} from "@/lib/analytics";
import {
  isDevModeEnabled,
  selectAndSaveGenotypeFile,
} from "@/lib/dev-mode";

type GenotypeContextType = {
  genotypeData: Map<string, string> | null;
  uploadGenotype: (file: File, source?: string) => Promise<boolean>;
  clearGenotype: () => void;
  isUploaded: boolean;
  isLoading: boolean;
  error: string | null;
  setOnDataLoadedCallback: (callback: (() => void) | null) => void;
  fileHash: string | null;
  originalFileName: string | null;
};

const GenotypeContext = createContext<GenotypeContextType | null>(null);

export function GenotypeProvider({ children }: { children: React.ReactNode }) {
  const [genotypeData, setGenotypeData] = useState<Map<string, string> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDataLoadedRef = useRef<(() => void) | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string | null>(null);

  const uploadGenotype = async (file: File, source: string = 'unknown') => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';

    setIsLoading(true);
    setError(null);
    trackGenotypeFileUploadStarted(source);

    try {
      if (!validateFileSize(file, 50)) {
        throw new Error('File too large. Maximum size is 50MB.');
      }

      if (!validateFileFormat(file)) {
        throw new Error('Unsupported file type. Please upload a .txt, .tsv, or .csv file exported from 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, or a compatible provider.');
      }

      const fileContent = await file.text();
      const hash = calculateFileHash(fileContent);

      const parseResult = detectAndParseGenotypeFile(fileContent);

      if (!parseResult.success) {
        const reason = parseResult.error || 'Failed to parse genotype data';
        console.error('[Upload] Parse failed', { file: file.name, ext: fileExtension, reason });
        throw new Error(reason);
      }

      const genotypeMap = new Map<string, string>();
      parseResult.data!.forEach((variant: GenotypeData) => {
        genotypeMap.set(variant.rsid, variant.genotype);
      });

      trackGenotypeFileLoaded(file.size, genotypeMap.size, source, parseResult.detectedFormat, fileExtension);

      setGenotypeData(genotypeMap);
      setFileHash(hash);
      setOriginalFileName(file.name);

      if (onDataLoadedRef.current) {
        onDataLoadedRef.current();
      }
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      console.error('[Upload] Failed', { file: file.name, ext: fileExtension, source, reason: errorMessage });
      setError(errorMessage);
      trackGenotypeFileUploadFailed(source, errorMessage, fileExtension);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const clearGenotype = () => {
    setGenotypeData(null);
    setError(null);
    setFileHash(null);
    setOriginalFileName(null);
    trackFileCleared();
  };

  const setOnDataLoadedCallback = useCallback((cb: (() => void) | null) => {
    // Store the callback in a ref to avoid render-phase state updates
    onDataLoadedRef.current = cb;
  }, []);

  return (
    <GenotypeContext.Provider value={{
      genotypeData,
      uploadGenotype,
      clearGenotype,
      isUploaded: !!genotypeData,
      isLoading,
      error,
      setOnDataLoadedCallback,
      fileHash,
      originalFileName,
    }}>
      {children}
    </GenotypeContext.Provider>
  );
}

export function useGenotype() {
  const context = useContext(GenotypeContext);
  if (!context) {
    throw new Error('useGenotype must be used within GenotypeProvider');
  }
  return context;
}

export default function UserDataUpload() {
  const { uploadGenotype, clearGenotype, isUploaded, isLoading, error } = useGenotype();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const openFilePicker = () => {
      if (!isLoading) {
        fileInputRef.current?.click();
      }
    };

    window.addEventListener('openDNAUploadPicker', openFilePicker);
    window.addEventListener('triggerDNAUpload', openFilePicker);

    return () => {
      window.removeEventListener('openDNAUploadPicker', openFilePicker);
      window.removeEventListener('triggerDNAUpload', openFilePicker);
    };
  }, [isLoading]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Dev mode: Try to use File System Access API to save handle for future auto-load
    if (isDevModeEnabled()) {
      try {
        const devFile = await selectAndSaveGenotypeFile();
        if (devFile) {
          await uploadGenotype(devFile, 'menu_upload');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }
      } catch (error) {
        console.log('[Dev Mode] Failed to use File System Access API, falling back to regular upload');
      }
    }

    // Regular upload
    await uploadGenotype(file, 'menu_upload');

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (isUploaded) {
    return (
      <div className="genotype-status">
        <span className="genotype-indicator">
          ✓ DNA loaded - ready to explore
        </span>
        <button
          className="genotype-clear"
          onClick={clearGenotype}
          title="Clear your personal data"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="genotype-upload">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.tsv,.csv"
        onChange={handleFileSelect}
        className="genotype-file-input"
        id="genotype-upload"
        disabled={isLoading}
      />
      <label htmlFor="genotype-upload" className={`genotype-upload-label ${isLoading ? 'loading' : ''}`}>
        {isLoading ? 'Analyzing your genetic map...' : 'Choose File to Upload'}
      </label>
      <p className="upload-format-hint">23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, and more</p>
      {error && (
        <div className="genotype-error">
          {error}
        </div>
      )}
      <div className="sample-data-section">
        <div className="divider">
          <span>or</span>
        </div>
        <a
          href="https://drive.google.com/file/d/1WK3zZbqmu3_m6LvoQCylyIbWBkoO5pGI/view?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
          className="sample-file-link"
          title="Download a sample DNA file to try out the app"
        >
          Download Sample Data
        </a>
        <p className="sample-description">Try the app with an anonymized sample dataset if you don't have your own DNA file yet.</p>
      </div>
    </div>
  );
}
