-- GWASifier Database Schema - PostgreSQL
-- This is the complete schema including all tables and indexes

-- ========================================
-- Enable Extensions
-- ========================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ========================================
-- Table: gwas_catalog
-- ========================================
-- Main GWAS catalog data table
-- ~1M rows, ~650 MB
CREATE TABLE public.gwas_catalog (
  id SERIAL PRIMARY KEY,
  date_added_to_catalog character varying,
  pubmedid character varying,
  first_author character varying,
  date character varying,
  journal character varying,
  link character varying,
  study character varying,
  disease_trait character varying,
  initial_sample_size character varying,
  replication_sample_size character varying,
  region character varying,
  chr_id character varying,
  chr_pos character varying,
  reported_genes character varying,
  mapped_gene character varying,
  upstream_gene_id character varying,
  downstream_gene_id character varying,
  snp_gene_ids character varying,
  upstream_gene_distance character varying,
  downstream_gene_distance character varying,
  strongest_snp_risk_allele character varying,
  snps character varying,
  merged character varying,
  snp_id_current character varying,
  context character varying,
  intergenic character varying,
  risk_allele_frequency character varying,
  p_value character varying,
  pvalue_mlog character varying,
  p_value_text character varying,
  or_or_beta character varying,
  ci_text character varying,
  platform_snps_passing_qc character varying,
  cnv character varying,
  mapped_trait character varying,
  mapped_trait_uri character varying,
  study_accession character varying,
  genotyping_technology character varying
);

-- Composite index for semantic search JOIN (non-unique to allow duplicate associations)
-- Note: gwas_catalog may have duplicate entries for the same (study_accession, snps, strongest_snp_risk_allele)
-- with different p-values or effect sizes. We keep all entries.
CREATE INDEX idx_gwas_catalog_composite ON gwas_catalog(study_accession, snps, strongest_snp_risk_allele);

-- ========================================
-- Table: study_embeddings
-- ========================================
-- Semantic search embeddings (nomic-embed-text-v1.5, 512 dims)
-- One embedding per unique (study_accession, snps, strongest_snp_risk_allele) combination
-- Note: gwas_catalog may have duplicates, but we store only one embedding per unique combo
-- ~1M rows, ~2.8 GB
CREATE TABLE public.study_embeddings (
  study_accession character varying NOT NULL,
  snps character varying NOT NULL,
  strongest_snp_risk_allele character varying NOT NULL,
  embedding vector(512) NOT NULL,        -- 512-dimensional embedding
  created_at TIMESTAMPTZ DEFAULT NOW(),  -- When embedding was generated
  updated_at TIMESTAMPTZ DEFAULT NOW(),  -- When embedding was last updated
  PRIMARY KEY (study_accession, snps, strongest_snp_risk_allele)
  -- Note: No FOREIGN KEY constraint because gwas_catalog allows duplicates
  -- The embedding JOIN will match all gwas_catalog rows with the same composite key
);

-- HNSW index for fast similarity search
-- m=16: number of bi-directional links per node (higher = better recall, more memory)
-- ef_construction=64: size of dynamic candidate list during index construction (higher = better quality, slower build)
CREATE INDEX idx_study_embeddings_embedding ON study_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Index for composite key lookups (covered by PRIMARY KEY, but explicit for clarity)
-- The PRIMARY KEY constraint automatically creates this index

-- ========================================
-- Table: embedding_cache
-- ========================================
-- Query embedding cache for faster repeated searches
CREATE TABLE public.embedding_cache (
  id SERIAL PRIMARY KEY,
  query TEXT UNIQUE NOT NULL,                -- Original search query
  embedding vector(512) NOT NULL,            -- Cached embedding (512 dimensions)
  created_at TIMESTAMPTZ DEFAULT NOW(),      -- When first cached
  accessed_at TIMESTAMPTZ DEFAULT NOW(),     -- Last access time (for LRU eviction)
  access_count INTEGER DEFAULT 1             -- Number of times accessed
);

-- Index for fast query lookups
CREATE INDEX idx_embedding_cache_query ON embedding_cache(query);

-- Index for LRU cleanup queries
CREATE INDEX idx_embedding_cache_accessed ON embedding_cache(accessed_at);

-- Index for analytics (most popular queries)
CREATE INDEX idx_embedding_cache_access_count ON embedding_cache(access_count DESC);

-- ========================================
-- Triggers: Auto-update cache access tracking
-- ========================================
CREATE OR REPLACE FUNCTION update_embedding_cache_access()
RETURNS TRIGGER AS $$
BEGIN
  NEW.accessed_at = NOW();
  NEW.access_count = OLD.access_count + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_embedding_cache_access
BEFORE UPDATE OF embedding ON embedding_cache
FOR EACH ROW
EXECUTE FUNCTION update_embedding_cache_access();

-- ========================================
-- Initial Data Population
-- ========================================
-- After loading gwas_catalog data, generate embeddings using scripts/generate-embeddings.py
-- The script will automatically populate study_embeddings with composite key foreign keys

-- ========================================
-- Performance Notes
-- ========================================
-- Storage per study: ~2 KB (embeddings) + ~650 bytes (catalog)
-- Total for 1M studies: ~650 MB (catalog) + ~2.8 GB (embeddings) + ~4 GB (HNSW) = ~7.5 GB
-- Semantic search latency: 10-30ms (HNSW) + ~1-2ms (composite key JOIN)
-- Cache size: ~2 KB per query, ~20 MB for 10K cached queries
--
-- Architecture benefits:
-- - Stable composite key (portable across database instances)
-- - Foreign key constraint ensures data integrity
-- - UNIQUE constraint on gwas_catalog prevents duplicate associations
-- - Embeddings can be backed up and restored to different databases

-- ========================================
-- Payment Verification
-- ========================================
-- Stripe subscriptions: Verified via direct Stripe API queries (no database storage needed)
-- Blockchain payments: Verified via Alchemy API indexer (no database storage needed)
