# Database Index Optimization for GWASifier

This directory contains SQL files to optimize database performance for the GWAS Catalog data used by GWASifier.

## Files

- `postgres_schema.sql` - Complete PostgreSQL schema with pgvector support
- `postgres_indexes.sql` - Indexes optimized for PostgreSQL databases

## Performance Impact

These indexes are designed to optimize the most common query patterns in GWASifier:

1. **Text searches** across studies, traits, authors, and genes
2. **P-value filtering** for statistical significance
3. **Sample size filtering** for study quality
4. **SNP lookups** for personal genotype analysis
5. **Trait enumeration** for the traits dropdown
6. **Sorting** by various criteria
7. **Semantic search** using pgvector for vector similarity

Expected performance improvements:
- **Search queries**: 10-100x faster
- **Filtering operations**: 5-50x faster
- **Trait loading**: 2-10x faster
- **Personal genotype analysis**: 5-20x faster
- **Semantic search**: 10-30ms with HNSW index

## Usage Instructions

### For PostgreSQL

```bash
# Apply schema to create tables
psql postgresql://user:password@host:port/database < sql/postgres_schema.sql

# Apply indexes to your PostgreSQL database
psql postgresql://user:password@host:port/database < sql/postgres_indexes.sql

# Update statistics for optimal query planning
psql postgresql://user:password@host:port/database -c "VACUUM ANALYZE gwas_catalog;"
```

## Important Notes

### Timing
- **Run indexes AFTER loading your data** - This is much more efficient than creating indexes first
- **Allow time for creation** - Index creation can take several minutes to hours depending on data size

### Space Requirements
- Indexes will increase database size by approximately **30-50%**
- For a 1GB GWAS catalog, expect indexes to add 300-500MB
- Semantic search embeddings add approximately **2.8GB** (for 1M studies)
- HNSW index adds approximately **4GB**

### PostgreSQL-Specific Features

The PostgreSQL indexes use advanced features for better performance:

- **pgvector extension** - Required for semantic search with vector similarity
- **HNSW indexes** - Hierarchical Navigable Small World for fast vector search
- **CONCURRENT creation** - Database remains available during index creation
- **Partial indexes** - Only index relevant rows to save space
- **GIN indexes** - Optimized for full-text search
- **Text pattern operators** - Optimized for LIKE queries
- **Covering indexes** - Include frequently accessed columns

### Maintenance

```sql
-- Update statistics (run weekly)
VACUUM ANALYZE gwas_catalog;
VACUUM ANALYZE study_embeddings;

-- Monitor index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename IN ('gwas_catalog', 'study_embeddings')
ORDER BY idx_scan DESC;
```

## Performance Monitoring

### Before and After Comparison

To measure the impact of these indexes:

1. **Record baseline performance**:
   ```bash
   # Time a complex search query
   time curl "http://localhost:3000/api/studies?search=diabetes&limit=100"
   ```

2. **Apply indexes using the appropriate SQL file**

3. **Measure improved performance**:
   ```bash
   # Same query should be significantly faster
   time curl "http://localhost:3000/api/studies?search=diabetes&limit=100"
   ```

### Query Examples That Benefit Most

These queries will see the biggest performance improvements:

```bash
# Text search across multiple fields
/api/studies?search=cardiovascular&limit=100

# P-value filtering
/api/studies?maxPValue=5e-8&limit=100

# Trait-specific queries
/api/studies?trait=type%202%20diabetes&limit=100

# Large sample size studies
/api/studies?minSampleSize=10000&limit=100

# Complex combinations
/api/studies?search=height&maxPValue=1e-10&minSampleSize=5000&limit=100

# Semantic search (with pgvector)
/api/studies?search=memory%20loss&searchMode=similarity&limit=100
```

## Troubleshooting

### PostgreSQL Issues
- If CONCURRENT creation fails, try without CONCURRENT
- Check `pg_stat_activity` for blocking queries during index creation
- Ensure sufficient `maintenance_work_mem` for large index creation
- Verify pgvector extension is enabled: `SELECT * FROM pg_extension WHERE extname = 'vector';`

### Performance Not Improved
- Run `VACUUM ANALYZE` to update query planner statistics
- Check that your queries are using the indexes with `EXPLAIN ANALYZE`
- Consider increasing cache settings for your database configuration
- For semantic search, verify HNSW index exists: `\d+ study_embeddings`

## Requirements

- **PostgreSQL 12+** (14+ recommended)
- **pgvector extension** (for semantic search)
- Sufficient disk space (see Space Requirements above)
- Adequate `maintenance_work_mem` for index creation (256MB+ recommended)
