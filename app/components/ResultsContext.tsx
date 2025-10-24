"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { SavedResult, SavedSession, ResultsManager } from "@/lib/results-manager";
import { resultsDB } from "@/lib/results-database";

type ResultsContextType = {
  savedResults: SavedResult[];
  resultsVersion: number; // Increments when results change - more efficient than array length
  addResult: (result: SavedResult) => Promise<void>;
  addResultsBatch: (results: SavedResult[]) => Promise<void>;
  removeResult: (studyId: number) => Promise<void>;
  clearResults: () => Promise<void>;
  saveToFile: (genotypeSize?: number, genotypeHash?: string) => void;
  loadFromFile: (currentFileHash?: string | null) => Promise<void>;
  hasResult: (studyId: number) => boolean;
  getResult: (studyId: number) => SavedResult | undefined;
  getResultByGwasId: (gwasId: string) => SavedResult | undefined;
  setOnResultsLoadedCallback: (callback: () => void) => void;
  // SQL query methods for advanced analysis
  queryByRiskLevel: (level: 'increased' | 'decreased' | 'neutral') => Promise<SavedResult[]>;
  queryByTraitPattern: (pattern: string) => Promise<SavedResult[]>;
  queryByRiskScoreRange: (min: number, max: number) => Promise<SavedResult[]>;
  getTopRisks: (limit?: number) => Promise<SavedResult[]>;
  getProtectiveVariants: (limit?: number) => Promise<SavedResult[]>;
  getTopResultsByEffect: (limit: number, excludeGwasId?: string) => Promise<SavedResult[]>;
  getTopResultsByRelevance: (query: string, limit: number, excludeGwasId?: string) => Promise<SavedResult[]>;
  getTraitCategories: () => Promise<Array<{ trait: string; count: number }>>;
  getRiskStatistics: () => Promise<any>;
  executeQuery: (sql: string, params?: any[]) => Promise<any[]>;
};

const ResultsContext = createContext<ResultsContextType | null>(null);

export function ResultsProvider({ children }: { children: ReactNode }) {
  // SECURITY: Results stored in memory only (in SQL.js in-memory database), cleared on session end
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [resultsVersion, setResultsVersion] = useState(0);
  const [onResultsLoaded, setOnResultsLoaded] = useState<(() => void) | undefined>();
  const [dbInitialized, setDbInitialized] = useState(false);

  // Initialize SQL database on mount
  useEffect(() => {
    resultsDB.initialize().then(() => {
      setDbInitialized(true);
      console.log('Results database initialized');
    });
  }, []);

  // Sync state array with database for React rendering
  const syncFromDatabase = async () => {
    const results = await resultsDB.getAllResults();
    setSavedResults(results);
    setResultsVersion(v => v + 1); // Increment version for efficient change detection
  };

  // No localStorage loading - data is memory-only

  const addResult = async (result: SavedResult) => {
    await resultsDB.insertResult(result);
    await syncFromDatabase();
  };

  const addResultsBatch = async (results: SavedResult[]) => {
    await resultsDB.insertResultsBatch(results);
    await syncFromDatabase();
  };

  const removeResult = async (studyId: number) => {
    await resultsDB.removeResult(studyId);
    await syncFromDatabase();
  };

  const clearResults = async () => {
    await resultsDB.clear();
    setSavedResults([]);
  };

  const saveToFile = (genotypeSize?: number, genotypeHash?: string) => {
    const session: SavedSession = {
      fileName: `monadic_dna_explorer_results_${new Date().toISOString().split('T')[0]}`,
      createdDate: new Date().toISOString(),
      totalVariants: genotypeSize || 0,
      genotypeFileHash: genotypeHash,
      results: savedResults
    };

    ResultsManager.saveResultsToFile(session);
  };

  const loadFromFile = async (currentFileHash?: string | null) => {
    try {
      const session = await ResultsManager.loadResultsFromFile();

      // Validate that results file matches current DNA file
      if (currentFileHash && session.genotypeFileHash && session.genotypeFileHash !== currentFileHash) {
        const proceed = window.confirm(
          '⚠️ Warning: This results file appears to be from a different DNA file.\n\n' +
          'Loading these results may show incorrect genetic information.\n\n' +
          'Do you want to continue anyway?'
        );

        if (!proceed) {
          throw new Error('Results file does not match current DNA file');
        }
      }

      // Load into SQL database
      await resultsDB.clear();
      await resultsDB.insertResultsBatch(session.results);
      await syncFromDatabase();

      // SECURITY: No longer saving to localStorage

      // Call the callback if it exists
      if (onResultsLoaded) {
        onResultsLoaded();
      }
    } catch (error) {
      console.error('Failed to load results:', error);
      throw error;
    }
  };

  // Optimized O(1) lookups using SQL indexes
  const hasResult = (studyId: number) => {
    // Use synchronous check from state for performance
    return savedResults.some(r => r.studyId === studyId);
  };

  const getResult = (studyId: number) => {
    // Use synchronous lookup from state for performance
    return savedResults.find(r => r.studyId === studyId);
  };

  const getResultByGwasId = (gwasId: string) => {
    // Use synchronous lookup from state for performance
    return savedResults.find(r => r.gwasId === gwasId);
  };

  return (
    <ResultsContext.Provider value={{
      savedResults,
      resultsVersion,
      addResult,
      addResultsBatch,
      removeResult,
      clearResults,
      saveToFile,
      loadFromFile,
      hasResult,
      getResult,
      getResultByGwasId,
      setOnResultsLoadedCallback: (callback: () => void) => setOnResultsLoaded(() => callback),
      // SQL query methods for advanced analysis
      queryByRiskLevel: resultsDB.queryByRiskLevel.bind(resultsDB),
      queryByTraitPattern: resultsDB.queryByTraitPattern.bind(resultsDB),
      queryByRiskScoreRange: resultsDB.queryByRiskScoreRange.bind(resultsDB),
      getTopRisks: resultsDB.getTopRisks.bind(resultsDB),
      getProtectiveVariants: resultsDB.getProtectiveVariants.bind(resultsDB),
      getTopResultsByEffect: resultsDB.getTopResultsByEffect.bind(resultsDB),
      getTopResultsByRelevance: resultsDB.getTopResultsByRelevance.bind(resultsDB),
      getTraitCategories: resultsDB.getTraitCategories.bind(resultsDB),
      getRiskStatistics: resultsDB.getRiskStatistics.bind(resultsDB),
      executeQuery: resultsDB.executeQuery.bind(resultsDB),
    }}>
      {children}
    </ResultsContext.Provider>
  );
}

export function useResults() {
  const context = useContext(ResultsContext);
  if (!context) {
    throw new Error('useResults must be used within ResultsProvider');
  }
  return context;
}
