import { coreCall } from "./core";

export type SavedResult = {
  studyId: number;
  gwasId?: string; // GWAS study accession ID
  traitName: string;
  studyTitle: string;
  userGenotype: string;
  riskAllele: string;
  effectSize: string;
  effectType?: 'OR' | 'beta'; // Effect type
  riskScore: number;
  riskLevel: 'increased' | 'decreased' | 'neutral';
  matchedSnp: string;
  analysisDate: string;
  pValue?: string; // P-value from GWAS catalog
  pValueMlog?: string; // -log10(p-value) from GWAS catalog
  mappedGene?: string; // Mapped gene from GWAS catalog
  sampleSize?: string; // Initial sample size from GWAS catalog
  replicationSampleSize?: string; // Replication sample size from GWAS catalog
  similarity?: number; // Semantic similarity score (0-1) from RAG search
};

export type SavedSession = {
  fileName: string;
  createdDate: string;
  totalVariants: number;
  genotypeFileHash?: string; // Hash of the original genotype file
  results: SavedResult[];
};

export class ResultsManager {
  // SECURITY: localStorage removed to prevent cleartext genetic data persistence
  // All results are now stored in memory only and cleared on session end

  static saveResultsToFile(session: SavedSession): void {
    const tsvContent = coreCall<string>("export_results", session.results);
    const dataBlob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `monadic_dna_explorer_results_${new Date().toISOString().split('T')[0]}.tsv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(link.href);
  }

  static parseResultsFile(content: string, fileName: string = 'results.tsv'): SavedSession {
    return coreCall("import_results", { content, fileName, now: new Date().toISOString() });
  }

  static loadResultsFromFile(): Promise<SavedSession> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.tsv,.json';

      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          reject(new Error('No file selected'));
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const content = e.target?.result as string;
            const session = ResultsManager.parseResultsFile(content, file.name);
            resolve(session);
          } catch (error) {
            reject(new Error('Failed to parse file: ' + (error as Error).message));
          }
        };

        reader.onerror = () => {
          reject(new Error('Failed to read file'));
        };

        reader.readAsText(file);
      };

      input.click();
    });
  }
}
