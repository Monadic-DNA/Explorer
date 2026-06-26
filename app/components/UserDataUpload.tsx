"use client";

import { useState, useRef, createContext, useContext, useCallback, useEffect } from "react";
import { GenotypeData, detectAndParseGenotypeFile, validateFileSize, validateFileFormat } from "@/lib/genotype-parser";
import { calculateFileHash } from "@/lib/file-hash";
import {
  trackFileCleared,
  trackGenotypeParseStarted,
  trackGenotypeParseSucceeded,
  trackGenotypeFileLoaded,
  trackGenotypeFileUploadFailed,
  trackGenotypeFileUploadStarted,
  trackProviderGuideClicked,
  trackUploadPickerOpened,
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
  originalFileSize: number | null;
  detectedFormat: string | null;
  fileExtension: string | null;
};

const GenotypeContext = createContext<GenotypeContextType | null>(null);

export function GenotypeProvider({ children }: { children: React.ReactNode }) {
  const [genotypeData, setGenotypeData] = useState<Map<string, string> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDataLoadedRef = useRef<(() => void) | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string | null>(null);
  const [originalFileSize, setOriginalFileSize] = useState<number | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);
  const [storedFileExtension, setStoredFileExtension] = useState<string | null>(null);

  const uploadGenotype = async (file: File, source: string = 'unknown') => {
    const dotIdx = file.name.lastIndexOf('.');
    const fileExtension = dotIdx !== -1 ? file.name.slice(dotIdx + 1).toLowerCase() : '';

    setIsLoading(true);
    setError(null);
    trackGenotypeFileUploadStarted(source);

    try {
      if (!validateFileSize(file, 50)) {
        throw new Error('File too large. Maximum size is 50MB.');
      }

      if (!validateFileFormat(file)) {
        throw new Error('Unsupported file type. Please upload a .txt, .tsv, .csv, or .gz file exported from 23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, or a compatible provider.');
      }

      let fileContent: string;
      if (fileExtension === 'gz') {
        const buffer = await file.arrayBuffer();
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(buffer);
        writer.close();
        const chunks: Uint8Array[] = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
        fileContent = new TextDecoder().decode(combined);
      } else {
        fileContent = await file.text();
      }
      const hash = calculateFileHash(fileContent);

      trackGenotypeParseStarted(source, fileExtension);
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

      trackGenotypeParseSucceeded(source, parseResult.detectedFormat, genotypeMap.size);
      trackGenotypeFileLoaded(file.size, genotypeMap.size, source, parseResult.detectedFormat, fileExtension);

      setGenotypeData(genotypeMap);
      setFileHash(hash);
      setOriginalFileName(file.name);
      setOriginalFileSize(file.size);
      setDetectedFormat(parseResult.detectedFormat || null);
      setStoredFileExtension(fileExtension || null);

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
    setOriginalFileSize(null);
    setDetectedFormat(null);
    setStoredFileExtension(null);
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
      originalFileSize,
      detectedFormat,
      fileExtension: storedFileExtension,
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
  const {
    uploadGenotype,
    clearGenotype,
    isUploaded,
    isLoading,
    error,
    genotypeData,
    originalFileName,
    originalFileSize,
    detectedFormat,
  } = useGenotype();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const openFilePicker = (event: Event) => {
      if (!isLoading) {
        const source = event instanceof CustomEvent && typeof event.detail?.source === 'string'
          ? event.detail.source
          : 'menu_upload';
        trackUploadPickerOpened(source);
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

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
      } catch {
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
    const fileSizeLabel = formatFileSize(originalFileSize);
    return (
      <div className="genotype-status">
        <div className="genotype-status-main">
          <span className="genotype-indicator">
            DNA file loaded
          </span>
          <span className="genotype-status-detail">
            {genotypeData?.size.toLocaleString()} variants parsed
            {detectedFormat ? ` from ${detectedFormat}` : ""}
            {fileSizeLabel ? `, ${fileSizeLabel}` : ""}
          </span>
          {originalFileName && (
            <span className="genotype-status-file">{originalFileName}</span>
          )}
          <span className="genotype-status-privacy">The raw file stayed in this browser.</span>
        </div>
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
        accept=".txt,.tsv,.csv,.gz"
        onChange={handleFileSelect}
        className="genotype-file-input"
        id="genotype-upload"
        disabled={isLoading}
      />
      <label htmlFor="genotype-upload" className={`genotype-upload-label ${isLoading ? 'loading' : ''}`}>
        {isLoading ? 'Analyzing your genetic map...' : 'Choose File to Upload'}
      </label>
      <p className="upload-format-hint">23andMe, AncestryDNA, MyHeritage, FTDNA, LivingDNA, and more. Compressed .gz files supported.</p>
      <div className="provider-guide-row" aria-label="Raw DNA download guides">
        <a href="https://monadicdna.com/guide/23andme" target="_blank" rel="noopener noreferrer" onClick={() => trackProviderGuideClicked("23andme", "upload")}>23andMe</a>
        <a href="https://monadicdna.com/guide/ancestry" target="_blank" rel="noopener noreferrer" onClick={() => trackProviderGuideClicked("ancestry", "upload")}>AncestryDNA</a>
        <a href="https://monadicdna.com/guide/myheritage" target="_blank" rel="noopener noreferrer" onClick={() => trackProviderGuideClicked("myheritage", "upload")}>MyHeritage</a>
        <a href="https://monadicdna.com/guide/ftdna" target="_blank" rel="noopener noreferrer" onClick={() => trackProviderGuideClicked("ftdna", "upload")}>FTDNA</a>
        <a href="https://monadicdna.com/guide/livingdna" target="_blank" rel="noopener noreferrer" onClick={() => trackProviderGuideClicked("livingdna", "upload")}>LivingDNA</a>
      </div>
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
        <p className="sample-description">Try the app with an anonymized sample dataset if you do not have your own DNA file yet.</p>
      </div>
    </div>
  );
}
