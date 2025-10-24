# Monadic DNA Explorer

Match your DNA data against an open ended catalogue of DNA traits with private LLM-powered analysis

**🔗 Repository:** [github.com/Monadic-DNA/Explorer](https://github.com/Monadic-DNA/Explorer)

## Features

- **Semantic Search**: LLM-powered semantic search understands the meaning of your queries (e.g., "memory loss" finds "cognitive decline" studies)
- **Interactive exploration** of GWAS Catalog studies with quality-aware filtering
- **Upload and analyze** your personal genetic data (23andMe, AncestryDNA, Monadic DNA)
- **Private LLM analysis** powered by Nillion's nilAI - your data is processed in a Trusted Execution Environment
- **Save and export** your results
- **Privacy-focused**: All semantic search processing happens on our servers (no third-party APIs)

## Development

### Preparing local data

Fetch the latest GWAS Catalog data from https://www.ebi.ac.uk/gwas/api/search/downloads/alternative into the `localdata` directory. This is "All associations v1.0.2 - with added ontology annotations, GWAS Catalog study accession numbers and genotyping technology" from https://www.ebi.ac.uk/gwas/docs/file-downloads.

Create a new SQLite database at `localdata/gwas_catalog.sqlite`.

Load the contents of the TSV file into the SQLite database using your favorite method.

### Running the Monadic DNA Explorer

The repository includes a Next.js single-page application for exploring studies stored in `localdata/gwas_catalog.sqlite`.

```bash
npm install
npm run dev
```

The development server defaults to http://localhost:3000. You can override the database location by exporting `GWAS_DB_PATH` before starting the server.

## Production Deployment

### Using PostgreSQL in Production

For production deployments, you can use a remote PostgreSQL database instead of the local SQLite database:

1. **Set up your PostgreSQL database** with the GWAS catalog data
2. **Set the `POSTGRES_DB` environment variable** to your PostgreSQL connection string:

```bash
export POSTGRES_DB="postgresql://username:password@host:port/database"
# or for production with SSL:
export POSTGRES_DB="postgresql://username:password@host:port/database?sslmode=require"
```

3. **Build and start the application**:

```bash
npm run build
npm start
```

### Environment Variables

- `POSTGRES_DB`: PostgreSQL connection string (if set, takes precedence over SQLite)
- `GWAS_DB_PATH`: Path to SQLite database file (only used if `POSTGRES_DB` is not set)
- `NILLION_API_KEY`: (Optional) API key for Nillion's nilAI to enable private AI analysis of results

### Database Schema

Complete database schemas are provided in the `sql/` directory:

- **PostgreSQL**: `sql/postgres_schema.sql` - Production schema with pgvector support
- **SQLite**: `sql/sqlite_schema.sql` - Development schema

Both schemas include:
- `gwas_catalog` table with auto-incrementing `id` primary key
- `study_embeddings` table with foreign key to `gwas_catalog.id`
- `embedding_cache` table for query caching
- All necessary indexes including HNSW for PostgreSQL

To initialize a fresh database:

```bash
# For PostgreSQL
psql $POSTGRES_DB < sql/postgres_schema.sql

# For SQLite
sqlite3 /path/to/gwas_catalog.sqlite < sql/sqlite_schema.sql
```

**Architecture benefits:**
- Simple integer foreign key JOINs (faster than string operations)
- Foreign key constraints ensure data integrity
- No redundant lookup tables needed
- Reduced storage and improved query performance

## Semantic Search Setup

The application includes LLM-powered semantic search that understands the meaning of queries, not just keywords.

### Prerequisites

1. **PostgreSQL with pgvector** (production) or **SQLite** (development)
2. **Python 3.8+** with GPU support (for initial embedding generation)

The complete database schema (including semantic search support) is in `sql/postgres_schema.sql` or `sql/sqlite_schema.sql`. See [Database Schema](#database-schema) section above for setup instructions.

**Note for PostgreSQL:** The `pgvector` extension is automatically enabled by the schema. Most managed PostgreSQL services (DigitalOcean, AWS RDS, etc.) allow extension creation by database owners.

### Step 1: Generate Study Embeddings

Use your local GPU to generate embeddings for all studies:

```bash
# Install Python dependencies
pip install -r scripts/requirements.txt

# For PostgreSQL (production) - save local backup
POSTGRES_DB="postgresql://..." python scripts/generate-embeddings.py --save-local embeddings_backup.npz

# For SQLite (development)
python scripts/generate-embeddings.py

# Load from local backup to new database (no GPU needed)
POSTGRES_DB="postgresql://..." python scripts/generate-embeddings.py --load-local embeddings_backup.npz

# Optional: Limit for testing
python scripts/generate-embeddings.py --limit 1000

# Adjust batch size based on GPU VRAM
python scripts/generate-embeddings.py --batch-size 256  # Default: 512
```

**Time estimate**: 20-60 minutes for 1M studies on a modern GPU (RTX 3080/4090)

**Local backup benefits**:
- Reuse embeddings for multiple databases
- No need to regenerate on database migration
- Transfer embeddings between environments
- Backup file size: ~500 MB compressed (for 1M studies, 512 dims)

The script uses **nomic-embed-text-v1.5** with:
- **512 dimensions** (33% storage savings, 0.5% quality loss vs 768)
- **Matryoshka representation learning** (efficient truncation)
- **Task-specific prefixes** (`search_document:` for studies)

### Step 2: Deploy Application

The application automatically generates query embeddings on-the-fly using Transformers.js.

**For DigitalOcean App Platform (Node.js Buildpack):**

1. **Configure deployment** using the provided `.do/app.yaml`:
   - Node.js buildpack (auto-detected)
   - Health check with 60s timeout (allows model download)
   - Professional-XS instance (1 vCPU, 1 GB RAM)

2. **Set environment variables** in DO dashboard:
   - `POSTGRES_DB`: Your PostgreSQL connection string

3. **Deploy** - push to GitHub or deploy via DO CLI

4. **First deployment**: Health check downloads model (~30-50s) before routing traffic

5. **Subsequent deployments**: Model re-downloads on each deploy (health check handles it)

**Cold start behavior:**
- First request after deploy: 10-20s (health check pre-warms model)
- Subsequent requests: <100ms (model already loaded)
- Model downloads: ~137 MB per deployment (cached in `/tmp/.transformers-cache`)

**Alternative: Docker Deployment (Optional)**

For faster cold starts and no repeated downloads, use the provided `Dockerfile`:

```yaml
# .do/app.yaml
services:
  - name: web
    dockerfile_path: Dockerfile  # Switch to Docker
```

Benefits:
- Cold start: 10-20s (model pre-baked in image)
- Model downloaded once during build (not per deploy)
- Larger image size: +137 MB

**For local development:**

```bash
npm install
npm run dev
```

The model downloads automatically on first search (~137 MB, cached in `.transformers-cache/`).

### Step 3: Test Semantic Search

Try these queries to see semantic search in action:

- **"memory loss"** → finds studies about "cognitive decline", "dementia", "Alzheimer's"
- **"heart attack"** → finds "myocardial infarction", "coronary artery disease"
- **"diabetes risk"** → finds "type 2 diabetes", "insulin resistance", "hyperglycemia"

**API Usage:**

```bash
# Semantic search (default)
curl "http://localhost:3000/api/studies?search=alzheimer%20risk"

# Keyword search (fallback)
curl "http://localhost:3000/api/studies?search=alzheimer%20risk&semantic=false"
```

### Architecture

**Two-tier caching for fast queries:**

1. **Memory cache** (100 hot queries): <1ms
2. **PostgreSQL cache** (10K warm queries): 2-5ms
3. **Generation** (cache miss): 50-100ms

**Query flow:**
```
User query → Check memory cache → Check DB cache → Generate embedding →
  pgvector similarity search → Filter + rank → Return results
```

**Storage requirements:**
- Study embeddings: ~2 KB per study (512 dims × 4 bytes)
- 1M studies: ~2 GB embeddings + ~4 GB HNSW index = 6 GB total
- Query cache: ~2 KB per cached query (~20 MB for 10K queries)
- Compared to old architecture: Saves ~105 MB by eliminating redundant lookup table

### Privacy & Security

- ✅ **No third-party APIs**: All embedding generation happens on your infrastructure
- ✅ **Self-hosted models**: Uses open-source nomic-embed-text-v1.5
- ✅ **Query privacy**: Search queries never leave your servers
- ✅ **Cache encryption**: Database cache uses standard PostgreSQL security
- ✅ **Ephemeral processing**: Query embeddings computed transiently (not logged)

### Monitoring & Maintenance

**Check embedding service status:**
```bash
curl http://localhost:3000/api/health
```

**Monitor cache performance:**
```sql
-- PostgreSQL
SELECT
  COUNT(*) as total_queries,
  AVG(access_count) as avg_accesses,
  MAX(access_count) as most_popular_count
FROM embedding_cache;

-- Top 20 most popular queries
SELECT query, access_count, accessed_at
FROM embedding_cache
ORDER BY access_count DESC
LIMIT 20;
```

**Clean up old cache entries** (run periodically):
```bash
# Via API (requires auth)
curl -X POST http://localhost:3000/api/admin/cache-cleanup \
  -H "Authorization: Bearer $ADMIN_SECRET"

# Or manually in PostgreSQL
DELETE FROM embedding_cache
WHERE accessed_at < NOW() - INTERVAL '90 days'
   OR id IN (
     SELECT id FROM embedding_cache
     ORDER BY accessed_at ASC
     LIMIT (SELECT COUNT(*) - 10000 FROM embedding_cache)
   );
```

### Troubleshooting

**Slow first search after deployment:**
- Model is loading (~5-10s). Health check at `/api/health` warms it up automatically.

**"Vector dimension mismatch" errors:**
- Ensure you used `--dimensions 512` when generating embeddings
- Check migration created `vector(512)` column (not `vector(768)`)

**Embeddings not found:**
- Verify schema applied: `\d study_embeddings` should show table exists
- Check embeddings generated: `SELECT COUNT(*) FROM study_embeddings;`

**Poor search quality:**
- Semantic search only works with PostgreSQL + pgvector (SQLite falls back to keyword search)
- Ensure HNSW index created: `\d+ study_embeddings` should show `idx_study_embeddings_embedding`

## License

**Dual License:** This software is available under a dual licensing model:

### Personal/Non-Commercial Use - MIT License
Free for personal, educational, academic, and non-commercial use under the MIT License. See [LICENSE-MIT.md](LICENSE-MIT.md) for details.

### Commercial Use - Commercial License Required
Commercial use requires obtaining a commercial license. This includes:
- Use in commercial products or services
- Use by for-profit organizations
- Integration into commercial applications
- Revenue-generating activities

**Contact us for commercial licensing:**
- Email: hello@monadicdna.com
- Website: https://monadicdna.com

See [LICENSE](LICENSE) for full dual license details and [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) for commercial license terms.

## Citations

Cerezo M, Sollis E, Ji Y, Lewis E, Abid A, Bircan KO, Hall P, Hayhurst J, John S, Mosaku A, Ramachandran S, Foreman A, Ibrahim A, McLaughlin J, Pendlington Z, Stefancsik R, Lambert SA, McMahon A, Morales J, Keane T, Inouye M, Parkinson H, Harris LW.
doi.org/10.1093/nar/gkae1070
Nucleic Acids Research, Volume 53, Issue D1, 6 January 2025, Pages D998–D1005
