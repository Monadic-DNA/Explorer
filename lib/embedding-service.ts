/**
 * Embedding Service using Transformers.js
 *
 * Generates embeddings for search queries using nomic-embed-text-v1.5
 * - Model: nomic-ai/nomic-embed-text-v1.5 (quantized)
 * - Dimensions: 512 (33% storage savings, 0.5% quality loss vs 768)
 * - Latency: 50-100ms (CPU), <1ms (cached)
 * - Cache: In-memory LRU cache
 *
 * Usage:
 *   const embedding = await embeddingService.embed("alzheimer risk");
 */

// Import will fail during build/SSR, so we lazy load it
let pipeline: any = null;
let env: any = null;

async function loadTransformers() {
  if (!pipeline) {
    const transformers = await import('@xenova/transformers');
    pipeline = transformers.pipeline;
    env = transformers.env;

    // Server-side: Use ONNX Runtime with GPU support if available
    // Check for CUDA availability (will use CPU as fallback)
    const useCuda = process.env.USE_CUDA === 'true';

    if (useCuda) {
      console.log('[Embedding] Attempting to use GPU (CUDA) for inference...');
      env.backends.onnx.executionProviders = ['cuda', 'cpu'];
    } else {
      console.log('[Embedding] Using CPU for inference');
      env.backends.onnx.executionProviders = ['cpu'];
    }

    // Configure cache directory
    env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp/.transformers-cache';
    env.allowLocalModels = true;
  }
  return { pipeline, env };
}

export class EmbeddingService {
  private model: any = null;
  private loading: Promise<void> | null = null;
  private readonly MODEL_NAME = 'nomic-ai/nomic-embed-text-v1.5';
  private readonly DIMENSIONS = 512; // Using 512 dims (Matryoshka truncation)

  // Simple in-memory LRU cache
  private cache: Map<string, number[]> = new Map();
  private readonly MAX_CACHE_SIZE = 1000;

  /**
   * Initialize the embedding model
   * Downloads model on first run (~137 MB quantized)
   * Subsequent runs load from cache
   */
  async initialize() {
    // Prevent multiple simultaneous loads
    if (this.loading) {
      await this.loading;
      return;
    }

    if (this.model) {
      return;
    }

    this.loading = (async () => {
      console.log('[Embedding] Loading nomic-embed-text-v1.5 (quantized)...');
      const start = Date.now();

      try {
        const { pipeline: pipelineFn } = await loadTransformers();

        this.model = await pipelineFn(
          'feature-extraction',
          this.MODEL_NAME,
          {
            quantized: true, // Use quantized model (137 MB vs 550 MB)
            progress_callback: (progress: any) => {
              if (progress.status === 'downloading' && progress.progress) {
                console.log(
                  `[Embedding] Downloading: ${progress.file} (${progress.progress.toFixed(1)}%)`
                );
              }
            },
          }
        );

        const elapsed = Date.now() - start;
        console.log(`[Embedding] Model loaded in ${elapsed}ms`);
      } catch (error) {
        this.loading = null;
        throw error;
      }
    })();

    await this.loading;
    this.loading = null;
  }

  /**
   * Generate embedding for a query string
   *
   * @param query - Search query text
   * @returns 512-dimensional embedding vector
   */
  async embed(query: string): Promise<number[]> {
    // Normalize query for consistent cache keys
    const normalized = query.trim().toLowerCase();

    // Check in-memory cache first
    const cached = this.cache.get(normalized);
    if (cached) {
      // Silent cache hit - no logging for performance
      return cached;
    }

    // Cache miss - generate embedding
    await this.initialize();

    const start = Date.now();

    try {
      // Add task prefix for query embedding (important!)
      // This aligns queries with document embeddings
      const prefixed = `search_query: ${query}`;

      // Generate embedding
      const output = await this.model(prefixed, {
        pooling: 'mean',
        normalize: true, // Important for cosine similarity
      });

      // Extract embedding and truncate to 512 dimensions (Matryoshka)
      const fullEmbedding = Array.from(output.data) as number[];
      const embedding = fullEmbedding.slice(0, this.DIMENSIONS);

      const elapsed = Date.now() - start;
      console.log(`[Embedding] Generated in ${elapsed}ms for: "${query}"`);

      // Store in in-memory cache (LRU)
      this.addToCache(normalized, embedding);

      return embedding;
    } catch (error) {
      console.error(`[Embedding] Failed to generate embedding:`, error);
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  /**
   * Add embedding to cache with LRU eviction
   */
  private addToCache(query: string, embedding: number[]): void {
    // LRU eviction: Remove oldest entry if cache is full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(query, embedding);
  }

  /**
   * Check if model is loaded
   */
  isReady(): boolean {
    return this.model !== null;
  }

  /**
   * Get model info
   */
  getInfo() {
    return {
      modelName: this.MODEL_NAME,
      dimensions: this.DIMENSIONS,
      quantized: true,
      ready: this.isReady(),
    };
  }
}

// Singleton instance
export const embeddingService = new EmbeddingService();
