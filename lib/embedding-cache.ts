/**
 * Two-tier embedding cache (Memory + PostgreSQL/SQLite)
 *
 * Tier 1: In-memory LRU cache (100 hot queries, <1ms access)
 * Tier 2: Database cache (10K warm queries, 2-5ms access)
 *
 * Benefits:
 * - Fast: Most queries served from memory (<1ms)
 * - Persistent: Survives app restarts
 * - Shared: Works across multiple app instances
 * - Analytics: Track popular queries
 */

import { executeQuery, executeQuerySingle, getDbType } from './db';

export class EmbeddingCache {
  // Tier 1: In-memory cache (hot queries)
  private memCache: Map<string, number[]> = new Map();
  private readonly MEM_CACHE_SIZE = 100;

  /**
   * Get embedding from cache (memory or database)
   */
  async get(query: string): Promise<number[] | null> {
    // Normalize query for consistent cache keys
    const normalized = this.normalizeQuery(query);

    // Try memory cache first (fastest: <1ms)
    const memHit = this.memCache.get(normalized);
    if (memHit) {
      console.log(`[Cache] Memory hit: "${query}"`);
      return memHit;
    }

    // Try database cache (persistent: 2-5ms)
    try {
      const dbType = getDbType();

      if (dbType === 'postgres') {
        // PostgreSQL: vector type
        const result = await executeQuerySingle<{ embedding: string }>(
          `SELECT embedding::text FROM embedding_cache WHERE query = ?`,
          [normalized]
        );

        if (result?.embedding) {
          // Parse vector string to array
          const embedding = this.parseEmbedding(result.embedding);
          console.log(`[Cache] DB hit (PostgreSQL): "${query}"`);

          // Promote to memory cache
          this.addToMemCache(normalized, embedding);

          // Update access tracking
          await this.updateAccessTracking(normalized);

          return embedding;
        }
      } else {
        // SQLite: JSON text
        const result = await executeQuerySingle<{ embedding: string }>(
          `SELECT embedding FROM embedding_cache WHERE query = ?`,
          [normalized]
        );

        if (result?.embedding) {
          const embedding = JSON.parse(result.embedding);
          console.log(`[Cache] DB hit (SQLite): "${query}"`);

          // Promote to memory cache
          this.addToMemCache(normalized, embedding);

          // Update access tracking
          await this.updateAccessTracking(normalized);

          return embedding;
        }
      }
    } catch (error) {
      console.error(`[Cache] DB lookup error:`, error);
      // Fall through to miss
    }

    console.log(`[Cache] Miss: "${query}"`);
    return null;
  }

  /**
   * Store embedding in cache (memory and database)
   */
  async set(query: string, embedding: number[]): Promise<void> {
    const normalized = this.normalizeQuery(query);

    // Add to memory cache (hot tier)
    this.addToMemCache(normalized, embedding);

    // Add to database cache (persistent tier)
    try {
      const dbType = getDbType();

      if (dbType === 'postgres') {
        // PostgreSQL: Use UPSERT with vector type
        await executeQuery(
          `INSERT INTO embedding_cache (query, embedding, created_at, accessed_at, access_count)
           VALUES (?, ?::vector, NOW(), NOW(), 1)
           ON CONFLICT (query) DO UPDATE
           SET embedding = ?::vector,
               accessed_at = NOW(),
               access_count = embedding_cache.access_count + 1`,
          [normalized, JSON.stringify(embedding), JSON.stringify(embedding)]
        );
      } else {
        // SQLite: Use INSERT OR REPLACE with JSON
        await executeQuery(
          `INSERT INTO embedding_cache (query, embedding, created_at, accessed_at, access_count)
           VALUES (?, ?, datetime('now'), datetime('now'), 1)
           ON CONFLICT(query) DO UPDATE
           SET embedding = ?,
               accessed_at = datetime('now'),
               access_count = access_count + 1`,
          [normalized, JSON.stringify(embedding), JSON.stringify(embedding)]
        );
      }

      console.log(`[Cache] Stored: "${query}"`);
    } catch (error) {
      console.error(`[Cache] Failed to store in DB:`, error);
      // Continue anyway - memory cache is still populated
    }
  }

  /**
   * Get cache statistics (for monitoring)
   */
  async getStats() {
    try {
      const stats = await executeQuerySingle<{
        total: number;
        avg_access_count: number;
        oldest: string;
      }>(
        `SELECT
          COUNT(*) as total,
          AVG(access_count) as avg_access_count,
          MIN(accessed_at) as oldest
         FROM embedding_cache`
      );

      return {
        dbCacheSize: stats?.total || 0,
        avgAccessCount: stats?.avg_access_count || 0,
        oldestEntry: stats?.oldest || null,
        memCacheSize: this.memCache.size,
        memCacheCapacity: this.MEM_CACHE_SIZE,
      };
    } catch (error) {
      console.error(`[Cache] Failed to get stats:`, error);
      return {
        dbCacheSize: 0,
        avgAccessCount: 0,
        oldestEntry: null,
        memCacheSize: this.memCache.size,
        memCacheCapacity: this.MEM_CACHE_SIZE,
      };
    }
  }

  /**
   * Cleanup old cache entries (LRU eviction + TTL)
   * Call periodically via cron job or admin endpoint
   */
  async cleanup(maxEntries: number = 10000, maxAgeDays: number = 90) {
    try {
      const dbType = getDbType();

      if (dbType === 'postgres') {
        // PostgreSQL: Delete old/unpopular entries
        await executeQuery(
          `DELETE FROM embedding_cache
           WHERE
             accessed_at < NOW() - INTERVAL '${maxAgeDays} days'
             OR id IN (
               SELECT id
               FROM embedding_cache
               WHERE accessed_at > NOW() - INTERVAL '${maxAgeDays} days'
               ORDER BY accessed_at ASC
               LIMIT (SELECT GREATEST(0, COUNT(*) - ?) FROM embedding_cache)
             )`,
          [maxEntries]
        );
      } else {
        // SQLite: Similar logic
        await executeQuery(
          `DELETE FROM embedding_cache
           WHERE
             accessed_at < datetime('now', '-${maxAgeDays} days')
             OR id IN (
               SELECT id
               FROM embedding_cache
               WHERE accessed_at > datetime('now', '-${maxAgeDays} days')
               ORDER BY accessed_at ASC
               LIMIT (SELECT MAX(0, COUNT(*) - ?) FROM embedding_cache)
             )`,
          [maxEntries]
        );
      }

      console.log(`[Cache] Cleanup complete (max ${maxEntries} entries, ${maxAgeDays} days TTL)`);
    } catch (error) {
      console.error(`[Cache] Cleanup failed:`, error);
    }
  }

  /**
   * Clear memory cache (useful for testing or memory pressure)
   */
  clearMemoryCache() {
    this.memCache.clear();
    console.log(`[Cache] Memory cache cleared`);
  }

  // Private helper methods

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  private addToMemCache(query: string, embedding: number[]) {
    // LRU eviction: Remove oldest entry if cache is full
    if (this.memCache.size >= this.MEM_CACHE_SIZE) {
      const firstKey = this.memCache.keys().next().value;
      if (firstKey) {
        this.memCache.delete(firstKey);
      }
    }
    this.memCache.set(query, embedding);
  }

  private async updateAccessTracking(query: string) {
    try {
      const dbType = getDbType();

      if (dbType === 'postgres') {
        await executeQuery(
          `UPDATE embedding_cache
           SET accessed_at = NOW(),
               access_count = access_count + 1
           WHERE query = ?`,
          [query]
        );
      } else {
        await executeQuery(
          `UPDATE embedding_cache
           SET accessed_at = datetime('now'),
               access_count = access_count + 1
           WHERE query = ?`,
          [query]
        );
      }
    } catch (error) {
      // Non-critical error, don't fail the request
      console.error(`[Cache] Failed to update access tracking:`, error);
    }
  }

  private parseEmbedding(embeddingStr: string): number[] {
    // PostgreSQL vector type returns format: "[0.1,0.2,0.3]"
    if (embeddingStr.startsWith('[') && embeddingStr.endsWith(']')) {
      return JSON.parse(embeddingStr);
    }
    // Fallback: JSON parse
    return JSON.parse(embeddingStr);
  }
}

// Singleton instance
export const embeddingCache = new EmbeddingCache();
