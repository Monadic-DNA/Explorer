-- PostgreSQL Index Optimization for GWAS Catalog
-- These indexes optimize the common query patterns used by Monadic DNA Explorer
--
-- Performance note: Run these after loading your data for optimal performance
-- Consider running VACUUM ANALYZE after creating indexes
--
-- Usage: psql -d your_database -f postgres_indexes.sql

-- 1. Search functionality indexes
-- Individual B-tree indexes for text search patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_study_accession ON gwas_catalog(study_accession);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_disease_trait ON gwas_catalog(disease_trait);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_mapped_trait ON gwas_catalog(mapped_trait);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_first_author ON gwas_catalog(first_author);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_mapped_gene ON gwas_catalog(mapped_gene);

-- Text search indexes using GIN for full-text search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_study_text ON gwas_catalog
USING GIN(to_tsvector('english', study));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_traits_text ON gwas_catalog
USING GIN(to_tsvector('english',
    COALESCE(disease_trait, '') || ' ' || COALESCE(mapped_trait, '')
));

-- Pattern matching indexes for LIKE queries (used in search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_study_pattern ON gwas_catalog(study text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_disease_trait_pattern ON gwas_catalog(disease_trait text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_mapped_trait_pattern ON gwas_catalog(mapped_trait text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_author_pattern ON gwas_catalog(first_author text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_gene_pattern ON gwas_catalog(mapped_gene text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_accession_pattern ON gwas_catalog(study_accession text_pattern_ops);

-- 2. Filtering indexes
-- P-value filtering (most common filter) - using numeric index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_pvalue ON gwas_catalog(p_value);

-- Sample size filtering with NULL handling
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_sample_size ON gwas_catalog(initial_sample_size)
WHERE initial_sample_size IS NOT NULL;

-- SNP-related indexes for genotype matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_snps ON gwas_catalog(snps)
WHERE snps IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_risk_allele ON gwas_catalog(strongest_snp_risk_allele)
WHERE strongest_snp_risk_allele IS NOT NULL;

-- 3. Sorting and performance indexes
-- Publication date for chronological sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_date ON gwas_catalog(date);

-- Journal for academic filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_journal ON gwas_catalog(journal);

-- PubMed ID for external linking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_pubmedid ON gwas_catalog(pubmedid);

-- 4. Composite indexes for common filter combinations
-- P-value + sample size (quality filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_quality_filters ON gwas_catalog(p_value, initial_sample_size)
WHERE p_value IS NOT NULL AND initial_sample_size IS NOT NULL;

-- Trait + p-value (trait-specific significance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_trait_pvalue ON gwas_catalog(mapped_trait, p_value)
WHERE mapped_trait IS NOT NULL AND p_value IS NOT NULL;

-- Study accession + SNP data (for study analysis)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_study_snp_data ON gwas_catalog(study_accession, snps, strongest_snp_risk_allele, or_or_beta)
WHERE snps IS NOT NULL AND strongest_snp_risk_allele IS NOT NULL AND or_or_beta IS NOT NULL;

-- 5. Traits API optimization
-- Functional index for the COALESCE expression used in traits query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_traits_coalesce ON gwas_catalog(
    COALESCE(NULLIF(TRIM(mapped_trait), ''), NULLIF(TRIM(disease_trait), ''))
) WHERE COALESCE(NULLIF(TRIM(mapped_trait), ''), NULLIF(TRIM(disease_trait), '')) IS NOT NULL;

-- Case-insensitive index for trait sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_traits_lower ON gwas_catalog(
    LOWER(COALESCE(NULLIF(TRIM(mapped_trait), ''), NULLIF(TRIM(disease_trait), '')))
) WHERE COALESCE(NULLIF(TRIM(mapped_trait), ''), NULLIF(TRIM(disease_trait), '')) IS NOT NULL;

-- 6. Data quality and completeness indexes
-- Index for records with complete genotype data (using study_accession instead of rowid)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_complete_genotype ON gwas_catalog(study_accession)
WHERE snps IS NOT NULL
  AND strongest_snp_risk_allele IS NOT NULL
  AND or_or_beta IS NOT NULL;

-- Index for high-quality studies (complete metadata)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_high_quality ON gwas_catalog(p_value, initial_sample_size, date)
WHERE p_value IS NOT NULL
  AND initial_sample_size IS NOT NULL
  AND date IS NOT NULL;

-- 7. Performance optimization indexes
-- Index for query planning (using study_accession instead of rowid)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_stats ON gwas_catalog(study_accession, p_value, initial_sample_size);

-- Covering index for common SELECT patterns (includes frequently accessed columns)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_covering ON gwas_catalog(
    study_accession,
    mapped_trait,
    p_value,
    initial_sample_size
) INCLUDE (
    study,
    disease_trait,
    first_author,
    date,
    journal
);

-- 8. Advanced PostgreSQL-specific optimizations

-- Partial index for significant p-values with safe numeric conversion
-- Handles very small p-values that might overflow double precision
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_significant_pvalue_safe ON gwas_catalog(p_value, mapped_trait)
WHERE p_value IS NOT NULL
  AND p_value != ''
  AND p_value != 'NR'
  AND (
    -- Handle scientific notation p-values that are very small
    p_value ~ '^[0-9]*\.?[0-9]+[Ee]-[0-9]+$'
    AND SUBSTRING(p_value FROM '[Ee]-([0-9]+)$')::INTEGER >= 5  -- E-5 or smaller
  );

-- Convertible p-values index (excludes extreme values that cause overflow)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_convertible_pvalue ON gwas_catalog(CAST(p_value AS FLOAT), mapped_trait)
WHERE p_value IS NOT NULL
  AND p_value != ''
  AND p_value != 'NR'
  AND p_value ~ '^[0-9]*\.?[0-9]+([Ee][+-]?[0-9]+)?$'  -- Valid numeric format
  AND (
    -- Exclude extremely small values that cause overflow
    NOT (p_value ~ '[Ee]-[0-9]{3,}$')  -- Exclude E-100, E-343, etc.
    OR SUBSTRING(p_value FROM '[Ee]-([0-9]+)$') IS NULL  -- Include non-scientific notation
    OR SUBSTRING(p_value FROM '[Ee]-([0-9]+)$')::INTEGER < 300  -- Include reasonable scientific notation
  );

-- Large studies index with proper type handling
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_large_studies ON gwas_catalog(CAST(initial_sample_size AS INTEGER), p_value)
WHERE initial_sample_size IS NOT NULL
  AND initial_sample_size != ''
  AND initial_sample_size != 'NR'
  AND initial_sample_size ~ '^[0-9]+$'
  AND CAST(initial_sample_size AS INTEGER) > 1000;

-- Metadata completeness index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_metadata_complete ON gwas_catalog(study_accession, mapped_trait)
WHERE study_accession IS NOT NULL
  AND mapped_trait IS NOT NULL
  AND p_value IS NOT NULL
  AND initial_sample_size IS NOT NULL;

-- Hash index for exact lookups (PostgreSQL 10+)
-- Uncomment if you frequently do exact study_accession lookups
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gwas_accession_hash ON gwas_catalog
-- USING HASH(study_accession);

-- 9. Maintenance and monitoring
-- Run these periodically for optimal performance:
--
-- Update table statistics:
-- VACUUM ANALYZE gwas_catalog;
-- ANALYZE gwas_catalog;
--
-- Check index usage (monitor index effectiveness):
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE tablename = 'gwas_catalog'
-- ORDER BY idx_scan DESC;
--
-- PostgreSQL configuration recommendations for large GWAS datasets:
-- shared_buffers = 25% of RAM
-- effective_cache_size = 75% of RAM
-- work_mem = 256MB - 1GB (depending on available RAM)
-- maintenance_work_mem = 2GB
-- random_page_cost = 1.1 (for SSD storage)
-- effective_io_concurrency = 200 (for SSD storage)
