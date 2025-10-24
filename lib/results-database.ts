// In-memory SQL database for genetic analysis results
// Optimized for complex queries, filtering, and analytical operations on 100k+ results

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import type { SavedResult } from './results-manager';

export type EmbeddingKey = {
  study_accession: string;
  snps: string;
  strongest_snp_risk_allele: string;
};

let SQL: SqlJsStatic | null = null;

async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: file => `https://sql.js.org/dist/${file}`
    });
  }
  return SQL;
}

// Helper function to fetch embeddings from PostgreSQL (with batching)
async function fetchEmbeddingsFromDB(keys: EmbeddingKey[]): Promise<Map<string, number[]>> {
  if (keys.length === 0) return new Map();

  const BATCH_SIZE = 1000; // API limit
  const embeddingsMap = new Map<string, number[]>();

  try {
    console.log(`[ResultsDB] Fetching ${keys.length} embeddings from PostgreSQL in batches of ${BATCH_SIZE}...`);

    // Fetch in batches
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(keys.length / BATCH_SIZE);

      console.log(`[ResultsDB] Fetching batch ${batchNum}/${totalBatches} (${batch.length} keys)...`);

      const response = await fetch('/api/fetch-embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: batch }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} for batch ${batchNum}`);
      }

      const data = await response.json();

      // Add to map
      for (const { key, embedding } of data.embeddings) {
        if (embedding) {
          embeddingsMap.set(key, embedding);
        }
      }
    }

    console.log(`[ResultsDB] ✓ Fetched ${embeddingsMap.size}/${keys.length} embeddings from PostgreSQL`);
    return embeddingsMap;
  } catch (error) {
    console.error('[ResultsDB] Failed to fetch embeddings:', error);
    throw error;
  }
}

export class ResultsDatabase {
  private db: Database | null = null;
  private sqlJs: SqlJsStatic | null = null;

  async initialize(): Promise<void> {
    this.sqlJs = await initSQL();
    this.db = new this.sqlJs.Database();

    // Create optimized schema with indexes
    this.db.run(`
      CREATE TABLE IF NOT EXISTS results (
        studyId INTEGER PRIMARY KEY,
        gwasId TEXT,
        traitName TEXT NOT NULL,
        studyTitle TEXT NOT NULL,
        userGenotype TEXT NOT NULL,
        riskAllele TEXT NOT NULL,
        effectSize TEXT NOT NULL,
        effectType TEXT,
        riskScore REAL NOT NULL,
        riskLevel TEXT NOT NULL,
        matchedSnp TEXT NOT NULL,
        analysisDate TEXT NOT NULL,
        embedding TEXT,
        pValue TEXT,
        pValueMlog TEXT,
        mappedGene TEXT,
        sampleSize TEXT,
        replicationSampleSize TEXT
      );
    `);

    // Create indexes for common query patterns
    this.db.run('CREATE INDEX IF NOT EXISTS idx_gwasId ON results(gwasId);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_traitName ON results(traitName);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_riskLevel ON results(riskLevel);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_riskScore ON results(riskScore);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_matchedSnp ON results(matchedSnp);');

    console.log('ResultsDatabase initialized with indexed schema');
  }

  async insertResult(result: SavedResult, generateEmbedding: boolean = false): Promise<void> {
    if (!this.db) await this.initialize();

    // Optionally generate embedding for semantic search (disabled by default for performance)
    // Note: Embedding generation is currently not implemented
    const embeddingJson: string | null = null;
    if (generateEmbedding) {
      console.warn('[ResultsDB] Embedding generation requested but not implemented');
    }

    this.db!.run(`
      INSERT OR REPLACE INTO results (
        studyId, gwasId, traitName, studyTitle, userGenotype,
        riskAllele, effectSize, effectType, riskScore, riskLevel, matchedSnp, analysisDate, embedding,
        pValue, pValueMlog, mappedGene, sampleSize, replicationSampleSize
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      result.studyId,
      result.gwasId || null,
      result.traitName,
      result.studyTitle,
      result.userGenotype,
      result.riskAllele,
      result.effectSize,
      result.effectType || null,
      result.riskScore,
      result.riskLevel,
      result.matchedSnp,
      result.analysisDate,
      embeddingJson,
      result.pValue || null,
      result.pValueMlog || null,
      result.mappedGene || null,
      result.sampleSize || null,
      result.replicationSampleSize || null
    ]);
  }

  async insertResultsBatch(results: SavedResult[]): Promise<void> {
    if (!this.db) await this.initialize();

    // Don't store embeddings in SQL.js - they'll be fetched on-demand from PostgreSQL
    const embeddings = new Array(results.length).fill(null);

    // Use transaction for batch insert (much faster)
    this.db!.run('BEGIN TRANSACTION;');

    try {
      const stmt = this.db!.prepare(`
        INSERT OR REPLACE INTO results (
          studyId, gwasId, traitName, studyTitle, userGenotype,
          riskAllele, effectSize, effectType, riskScore, riskLevel, matchedSnp, analysisDate, embedding,
          pValue, pValueMlog, mappedGene, sampleSize, replicationSampleSize
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        stmt.run([
          result.studyId,
          result.gwasId || null,
          result.traitName,
          result.studyTitle,
          result.userGenotype,
          result.riskAllele,
          result.effectSize,
          result.effectType || null,
          result.riskScore,
          result.riskLevel,
          result.matchedSnp,
          result.analysisDate,
          embeddings[i],
          result.pValue || null,
          result.pValueMlog || null,
          result.mappedGene || null,
          result.sampleSize || null,
          result.replicationSampleSize || null
        ]);
      }

      stmt.free();
      this.db!.run('COMMIT;');
      console.log(`Batch inserted ${results.length} results`);
    } catch (error) {
      // Only rollback if transaction is still active
      try {
        this.db!.run('ROLLBACK;');
      } catch (rollbackError) {
        console.warn('Rollback failed (transaction may have already completed):', rollbackError);
      }
      console.error('Batch insert failed:', error);
      throw error;
    }
  }

  async getResult(studyId: number): Promise<SavedResult | null> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results WHERE studyId = ?
    `, [studyId]);

    if (!result.length || !result[0].values.length) return null;

    return this.rowToResult(result[0].columns, result[0].values[0]);
  }

  async getResultByGwasId(gwasId: string): Promise<SavedResult | null> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results WHERE gwasId = ?
    `, [gwasId]);

    if (!result.length || !result[0].values.length) return null;

    return this.rowToResult(result[0].columns, result[0].values[0]);
  }

  async hasResult(studyId: number): Promise<boolean> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT 1 FROM results WHERE studyId = ? LIMIT 1
    `, [studyId]);

    return result.length > 0 && result[0].values.length > 0;
  }

  async getAllResults(): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`SELECT * FROM results`);

    if (!result.length) return [];

    return result[0].values.map(row =>
      this.rowToResult(result[0].columns, row)
    );
  }

  async getCount(): Promise<number> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`SELECT COUNT(*) as count FROM results`);

    if (!result.length || !result[0].values.length) return 0;

    return result[0].values[0][0] as number;
  }

  async removeResult(studyId: number): Promise<void> {
    if (!this.db) await this.initialize();

    this.db!.run(`DELETE FROM results WHERE studyId = ?`, [studyId]);
  }

  async clear(): Promise<void> {
    if (!this.db) await this.initialize();

    this.db!.run(`DELETE FROM results`);
  }

  // Advanced query methods for LLM analysis

  async queryByRiskLevel(riskLevel: 'increased' | 'decreased' | 'neutral'): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results WHERE riskLevel = ?
    `, [riskLevel]);

    if (!result.length) return [];

    return result[0].values.map(row => this.rowToResult(result[0].columns, row));
  }

  async queryByTraitPattern(pattern: string): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results WHERE traitName LIKE ?
    `, [`%${pattern}%`]);

    if (!result.length) return [];

    return result[0].values.map(row => this.rowToResult(result[0].columns, row));
  }

  async queryByRiskScoreRange(minScore: number, maxScore: number): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results
      WHERE riskScore >= ? AND riskScore <= ?
      ORDER BY riskScore DESC
    `, [minScore, maxScore]);

    if (!result.length) return [];

    return result[0].values.map(row => this.rowToResult(result[0].columns, row));
  }

  async getTopRisks(limit: number = 10): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results
      WHERE riskLevel = 'increased'
      ORDER BY riskScore DESC
      LIMIT ?
    `, [limit]);

    if (!result.length) return [];

    return result[0].values.map(row => this.rowToResult(result[0].columns, row));
  }

  async getProtectiveVariants(limit: number = 10): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT * FROM results
      WHERE riskLevel = 'decreased'
      ORDER BY riskScore ASC
      LIMIT ?
    `, [limit]);

    if (!result.length) return [];

    return result[0].values.map(row => this.rowToResult(result[0].columns, row));
  }

  // Optimized method for LLM context: Get top N results by effect size, excluding specific gwasId
  async getTopResultsByEffect(limit: number, excludeGwasId?: string): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    // Order by absolute distance from 1.0 (neutral risk score)
    // This gives us the most significant results regardless of direction
    const result = this.db!.exec(`
      SELECT * FROM results
      WHERE gwasId IS NOT NULL ${excludeGwasId ? 'AND gwasId != ?' : ''}
      ORDER BY ABS(riskScore - 1.0) DESC
      LIMIT ?
    `, excludeGwasId ? [excludeGwasId, limit] : [limit]);

    if (!result.length) return [];

    return result[0].values.map(row => this.rowToResult(result[0].columns, row));
  }

  // Generate embeddings for results that don't have them yet (lazy generation)
  async generateMissingEmbeddings(_maxResults?: number): Promise<number> {
    // Note: Embedding generation is currently not implemented
    console.warn('[ResultsDB] generateMissingEmbeddings called but not implemented');
    return 0;

    /* Disabled code below - would need to integrate with embeddingService or API
    if (!this.db) await this.initialize();

    console.log(`[ResultsDB] Checking for results without embeddings...`);

    // Get results without embeddings
    const result = this.db!.exec(`
      SELECT * FROM results WHERE embedding IS NULL ${maxResults ? `LIMIT ${maxResults}` : ''}
    `);

    if (!result.length || !result[0].values.length) {
      console.log(`[ResultsDB] All results have embeddings`);
      return 0;
    }

    const resultsToEmbed = result[0].values.map(row => this.rowToResult(result[0].columns, row));
    console.log(`[ResultsDB] Generating embeddings for ${resultsToEmbed.length} results via server-side API...`);

    const startTime = Date.now();
    let embeddedCount = 0;

    // Generate embeddings via API in batches
    const BATCH_SIZE = 100;
    const embeddingResults: Array<{ studyId: number; embedding: string } | null> = [];

    for (let i = 0; i < resultsToEmbed.length; i += BATCH_SIZE) {
      const batch = resultsToEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map(r => `${r.traitName} ${r.studyTitle}`);

      try {
        const batchEmbeddings = await generateEmbeddingsAPI(texts);
        for (let j = 0; j < batch.length; j++) {
          if (batchEmbeddings[j]) {
            embeddingResults.push({
              studyId: batch[j].studyId,
              embedding: JSON.stringify(batchEmbeddings[j])
            });
          } else {
            embeddingResults.push(null);
          }
        }
        console.log(`[ResultsDB] Generated batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(resultsToEmbed.length / BATCH_SIZE)}`);
      } catch (error) {
        console.error(`[ResultsDB] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error);
        // Fill with nulls for failed batch
        embeddingResults.push(...new Array(batch.length).fill(null));
      }
    }

    // Update database with generated embeddings
    this.db!.run('BEGIN TRANSACTION;');
    try {
      const stmt = this.db!.prepare(`UPDATE results SET embedding = ? WHERE studyId = ?`);
      for (const embResult of embeddingResults) {
        if (embResult) {
          stmt.run([embResult.embedding, embResult.studyId]);
          embeddedCount++;
        }
      }
      stmt.free();
      this.db!.run('COMMIT;');
    } catch (error) {
      this.db!.run('ROLLBACK;');
      throw error;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[ResultsDB] Generated ${embeddedCount} embeddings in ${elapsed}ms`);

    return embeddedCount;
    */
  }

  // Semantic search method for LLM context: Get top N results by relevance to query
  async getTopResultsByRelevance(query: string, limit: number, excludeGwasId?: string): Promise<SavedResult[]> {
    if (!this.db) await this.initialize();

    console.log(`[ResultsDB] Semantic search for: "${query}"`);
    const startTime = Date.now();

    try {
      // Step 1: Use PostgreSQL vector similarity to find top N most similar studies
      console.log(`[ResultsDB] Querying PostgreSQL for ${limit} most similar studies...`);
      const response = await fetch('/api/similar-studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const similarStudies = data.studies;

      console.log(`[ResultsDB] ✓ Found ${similarStudies.length} similar studies from PostgreSQL vector search`);

      if (similarStudies.length === 0) {
        console.warn('[ResultsDB] No similar studies found');
        console.warn('[ResultsDB] ⚠️  FALLING BACK TO SIGNIFICANCE-BASED RANKING');
        return this.getTopResultsByEffect(limit, excludeGwasId);
      }

      // Step 2: Build index of similar studies for fast lookup
      const similarStudiesSet = new Set<string>();
      for (const study of similarStudies) {
        const key = `${study.study_accession}|${study.snps}|${study.strongest_snp_risk_allele}`;
        similarStudiesSet.add(key);
      }

      // Step 3: Get all user results and filter to those that match similar studies
      const result = this.db!.exec(`
        SELECT * FROM results
        WHERE gwasId IS NOT NULL ${excludeGwasId ? 'AND gwasId != ?' : ''}
      `, excludeGwasId ? [excludeGwasId] : []);

      if (!result.length || !result[0].values.length) {
        console.warn('[ResultsDB] No user results found');
        return [];
      }

      const allResults = result[0].values.map(row => this.rowToResult(result[0].columns, row));

      // Step 4: Match user results with similar studies and preserve similarity order
      // Note: We match on study_accession only, not the full composite key, because:
      // - Users may have multiple results per study (different SNPs)
      // - The embedding is at the study level, not SNP level
      const matchedResults: SavedResult[] = [];
      const matchedResultIds = new Set<number>();

      // Debug: Sample a few study accessions and user gwasIds
      const sampleStudies = similarStudies.slice(0, 10).map((s: { study_accession: string }) => s.study_accession);
      const sampleUserGwasIds = allResults.slice(0, 20).map(r => r.gwasId).filter(id => id);
      console.log('[ResultsDB] PostgreSQL studies (first 10):', JSON.stringify(sampleStudies));
      console.log('[ResultsDB] User gwasIds (first 20):', JSON.stringify(sampleUserGwasIds));

      // Check for exact match
      const hasMatch = sampleStudies.some((study: string) => sampleUserGwasIds.includes(study));
      console.log('[ResultsDB] Any matches in samples?', hasMatch);

      // Count unique user studies
      const uniqueUserStudies = new Set(allResults.map(r => r.gwasId).filter(id => id));
      console.log('[ResultsDB] User has results for', uniqueUserStudies.size, 'unique studies');

      for (const study of similarStudies) {
        const studyAccession = study.study_accession;

        // Find ALL matching user results for this study
        for (const userResult of allResults) {
          if (!userResult.gwasId) continue;
          if (matchedResultIds.has(userResult.studyId)) continue; // Skip duplicates

          // Match on study accession (gwasId)
          if (userResult.gwasId === studyAccession) {
            matchedResults.push(userResult);
            matchedResultIds.add(userResult.studyId);
          }
        }

        if (matchedResults.length >= limit) break;
      }

      // Debug: If very few matches, log the mismatch
      if (matchedResults.length < 10 && similarStudies.length > 100) {
        console.warn(`[ResultsDB] Low match rate: ${matchedResults.length} matches from ${similarStudies.length} studies and ${allResults.length} user results`);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[ResultsDB] ✓ Semantic search completed in ${elapsed}ms`);
      console.log(`[ResultsDB] ✓ Matched ${matchedResults.length} user results to similar studies`);

      // Debug: Log top 10 matches
      const topMatches = matchedResults.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        trait: r.traitName,
        study: r.gwasId
      }));
      console.log('[ResultsDB] Top 10 matched results:', topMatches);

      return matchedResults;

    } catch (error) {
      console.error('[ResultsDB] ❌ Failed to perform semantic search:', error);
      console.warn('[ResultsDB] ⚠️  FALLING BACK TO SIGNIFICANCE-BASED RANKING');
      return this.getTopResultsByEffect(limit, excludeGwasId);
    }
  }

  // Helper: Compute cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  async getTraitCategories(): Promise<Array<{ trait: string; count: number }>> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT traitName as trait, COUNT(*) as count
      FROM results
      GROUP BY traitName
      ORDER BY count DESC
    `);

    if (!result.length) return [];

    return result[0].values.map(row => ({
      trait: row[0] as string,
      count: row[1] as number
    }));
  }

  async getRiskStatistics(): Promise<{
    totalResults: number;
    increasedRisk: number;
    decreasedRisk: number;
    neutral: number;
    avgRiskScore: number;
  }> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN riskLevel = 'increased' THEN 1 ELSE 0 END) as increased,
        SUM(CASE WHEN riskLevel = 'decreased' THEN 1 ELSE 0 END) as decreased,
        SUM(CASE WHEN riskLevel = 'neutral' THEN 1 ELSE 0 END) as neutral,
        AVG(riskScore) as avgScore
      FROM results
    `);

    if (!result.length || !result[0].values.length) {
      return { totalResults: 0, increasedRisk: 0, decreasedRisk: 0, neutral: 0, avgRiskScore: 0 };
    }

    const row = result[0].values[0];
    return {
      totalResults: row[0] as number,
      increasedRisk: row[1] as number,
      decreasedRisk: row[2] as number,
      neutral: row[3] as number,
      avgRiskScore: row[4] as number
    };
  }

  // Custom SQL query for advanced analysis
  async executeQuery(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db) await this.initialize();

    const result = this.db!.exec(sql, params);

    if (!result.length) return [];

    return result[0].values.map(row => {
      const obj: any = {};
      result[0].columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });
  }

  private rowToResult(columns: string[], row: any[]): SavedResult {
    const obj: any = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });

    return {
      studyId: obj.studyId,
      gwasId: obj.gwasId,
      traitName: obj.traitName,
      studyTitle: obj.studyTitle,
      userGenotype: obj.userGenotype,
      riskAllele: obj.riskAllele,
      effectSize: obj.effectSize,
      effectType: obj.effectType || undefined,
      riskScore: obj.riskScore,
      riskLevel: obj.riskLevel,
      matchedSnp: obj.matchedSnp,
      analysisDate: obj.analysisDate,
      pValue: obj.pValue || undefined,
      pValueMlog: obj.pValueMlog || undefined,
      mappedGene: obj.mappedGene || undefined,
      sampleSize: obj.sampleSize || undefined,
      replicationSampleSize: obj.replicationSampleSize || undefined
    };
  }

  // Export database state (for debugging)
  async exportToArray(): Promise<Uint8Array | null> {
    if (!this.db) return null;
    return this.db.export();
  }

  // Import database state
  async importFromArray(data: Uint8Array): Promise<void> {
    this.sqlJs = await initSQL();
    this.db = new this.sqlJs.Database(data);
  }
}

export const resultsDB = new ResultsDatabase();
