-- GWASifier Database Schema - SQLite
-- This is the complete schema including all tables and indexes
-- Note: SQLite version is for development/testing only
-- Production should use PostgreSQL with pgvector for better performance

-- ========================================
-- Table: gwas_catalog
-- ========================================
-- Main GWAS catalog data table
-- ~1M rows, ~650 MB
CREATE TABLE gwas_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_added_to_catalog TEXT,
  pubmedid TEXT,
  first_author TEXT,
  date TEXT,
  journal TEXT,
  link TEXT,
  study TEXT,
  disease_trait TEXT,
  initial_sample_size TEXT,
  replication_sample_size TEXT,
  region TEXT,
  chr_id TEXT,
  chr_pos TEXT,
  reported_genes TEXT,
  mapped_gene TEXT,
  upstream_gene_id TEXT,
  downstream_gene_id TEXT,
  snp_gene_ids TEXT,
  upstream_gene_distance TEXT,
  downstream_gene_distance TEXT,
  strongest_snp_risk_allele TEXT,
  snps TEXT,
  merged TEXT,
  snp_id_current TEXT,
  context TEXT,
  intergenic TEXT,
  risk_allele_frequency TEXT,
  p_value TEXT,
  pvalue_mlog TEXT,
  p_value_text TEXT,
  or_or_beta TEXT,
  ci_text TEXT,
  platform_snps_passing_qc TEXT,
  cnv TEXT,
  mapped_trait TEXT,
  mapped_trait_uri TEXT,
  study_accession TEXT,
  genotyping_technology TEXT
);

-- Composite index for semantic search JOIN
CREATE INDEX idx_gwas_catalog_composite ON gwas_catalog(study_accession, snps, strongest_snp_risk_allele);

-- ========================================
-- Table: study_embeddings
-- ========================================
-- Semantic search embeddings (stored as JSON arrays)
-- One embedding per gwas_catalog row
-- ~1M rows
-- Note: SQLite doesn't support pgvector, embeddings stored as TEXT (JSON array format)
CREATE TABLE study_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gwas_catalog_id INTEGER UNIQUE NOT NULL,
  embedding TEXT NOT NULL,                       -- Embedding as JSON array: "[0.1, 0.2, ...]"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- When embedding was generated
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- When embedding was last updated
  FOREIGN KEY (gwas_catalog_id) REFERENCES gwas_catalog(id) ON DELETE CASCADE
);

-- Index on gwas_catalog_id for fast joins
CREATE INDEX idx_study_embeddings_gwas_id ON study_embeddings(gwas_catalog_id);

-- ========================================
-- Table: embedding_cache
-- ========================================
-- Query embedding cache for faster repeated searches
CREATE TABLE embedding_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT UNIQUE NOT NULL,                -- Original search query
  embedding TEXT NOT NULL,                   -- Cached embedding (JSON array format)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,      -- When first cached
  accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,     -- Last access time (for LRU eviction)
  access_count INTEGER DEFAULT 1             -- Number of times accessed
);

-- Index for fast query lookups
CREATE INDEX idx_embedding_cache_query ON embedding_cache(query);

-- Index for LRU cleanup queries
CREATE INDEX idx_embedding_cache_accessed ON embedding_cache(accessed_at);

-- Index for analytics (most popular queries)
CREATE INDEX idx_embedding_cache_access_count ON embedding_cache(access_count DESC);

-- ========================================
-- Initial Data Population
-- ========================================
-- After loading gwas_catalog data, generate embeddings using scripts/generate-embeddings.py
-- The script will automatically populate study_embeddings with gwas_catalog_id foreign keys

-- ========================================
-- Performance Notes
-- ========================================
-- SQLite semantic search is significantly slower than PostgreSQL (no HNSW index)
-- Suitable for development/testing with smaller datasets
-- For production with large datasets, use PostgreSQL with pgvector extension
--
-- Architecture benefits:
-- - Simple integer foreign key JOINs (faster than string operations)
-- - Foreign key constraint ensures data integrity
-- - No redundant lookup tables needed
--
-- Access tracking for embedding_cache is handled in application code
-- (SQLite doesn't support the same trigger functionality as PostgreSQL)
