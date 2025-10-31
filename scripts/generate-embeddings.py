#!/usr/bin/env python3
"""
Generate embeddings for all studies in GWAS catalog using local GPU.

This script:
1. Connects to either SQLite or PostgreSQL database
2. Fetches all studies from gwas_catalog table (that don't have embeddings yet)
3. Generates embeddings using nomic-embed-text-v1.5 (sentence-transformers)
4. Stores embeddings in separate study_embeddings table (decoupled from catalog data)

Usage:
    # For SQLite (default):
    python scripts/generate-embeddings.py

    # For PostgreSQL:
    POSTGRES_DB="postgresql://user:pass@host:port/dbname" python scripts/generate-embeddings.py

    # Save embeddings locally (for backup or reuse):
    python scripts/generate-embeddings.py --save-local embeddings_backup.npz

    # Load from local file and upload to new database:
    POSTGRES_DB="postgresql://..." python scripts/generate-embeddings.py --load-local embeddings_backup.npz

    # Custom options:
    python scripts/generate-embeddings.py --batch-size 256 --dimensions 512

Requirements:
    pip install sentence-transformers psycopg2-binary numpy tqdm
"""

import os
import sys
import argparse
import json
from typing import List, Tuple, Optional
import sqlite3
import psycopg2
import psycopg2.extras
import numpy as np
from sentence_transformers import SentenceTransformer
from tqdm import tqdm


def get_db_connection(postgres_conn_str: Optional[str] = None):
    """Get database connection (SQLite or PostgreSQL)."""

    if postgres_conn_str:
        print(f"📡 Connecting to PostgreSQL...")
        # Parse connection string to hide password in logs
        safe_conn = postgres_conn_str.split('@')[-1] if '@' in postgres_conn_str else postgres_conn_str
        print(f"   Host: {safe_conn}")

        conn = psycopg2.connect(postgres_conn_str)
        db_type = 'postgres'
    else:
        # Default to SQLite
        db_path = os.environ.get('GWAS_DB_PATH', 'localdata/gwas_catalog.sqlite')
        print(f"📁 Connecting to SQLite: {db_path}")

        if not os.path.exists(db_path):
            raise FileNotFoundError(f"SQLite database not found at {db_path}")

        conn = sqlite3.connect(db_path)
        db_type = 'sqlite'

    return conn, db_type


def fetch_studies(conn, db_type: str, limit: Optional[int] = None) -> List[Tuple]:
    """Fetch studies from database that don't have embeddings yet.

    Returns:
        List of tuples: (study_accession, snps, strongest_snp_risk_allele, combined_text)
    """
    cursor = conn.cursor()

    # Fetch studies that don't have embeddings yet
    # Join with study_embeddings table to find missing embeddings
    # Use composite key (study_accession, snps, strongest_snp_risk_allele) for stability across DB instances
    query = """
        SELECT
            gc.study_accession,
            gc.snps,
            gc.strongest_snp_risk_allele,
            COALESCE(gc.mapped_trait, '') || ' ' ||
            COALESCE(gc.disease_trait, '') || ' ' ||
            COALESCE(gc.study, '') || ' ' ||
            COALESCE(gc.mapped_gene, '') AS combined_text
        FROM gwas_catalog gc
        LEFT JOIN study_embeddings se ON (
            se.study_accession = gc.study_accession
            AND se.snps = gc.snps
            AND se.strongest_snp_risk_allele = gc.strongest_snp_risk_allele
        )
        WHERE se.study_accession IS NULL
    """

    if limit:
        query += f" LIMIT {limit}"

    cursor.execute(query)
    studies = cursor.fetchall()

    print(f"📊 Found {len(studies)} studies without embeddings")

    return studies


def generate_embeddings(
    model: SentenceTransformer,
    texts: List[str],
    batch_size: int = 512,
    dimensions: int = 512
) -> np.ndarray:
    """Generate embeddings for texts using sentence-transformers.

    Args:
        model: Loaded sentence-transformers model
        texts: List of text strings to embed
        batch_size: Batch size for encoding (adjust based on GPU VRAM)
        dimensions: Number of dimensions to keep (512 or 768)

    Returns:
        numpy array of shape (len(texts), dimensions)
    """
    print(f"🧠 Generating embeddings...")
    print(f"   Model: nomic-ai/nomic-embed-text-v1.5")
    print(f"   Batch size: {batch_size}")
    print(f"   Dimensions: {dimensions}")

    # Add task prefix for document embedding
    prefixed_texts = [f"search_document: {text.strip()}" for text in texts]

    # Generate embeddings with progress bar
    embeddings = model.encode(
        prefixed_texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,  # Important for cosine similarity
        convert_to_numpy=True
    )

    # Truncate to desired dimensions (Matryoshka representation)
    if dimensions < embeddings.shape[1]:
        embeddings = embeddings[:, :dimensions]
        print(f"   Truncated to {dimensions} dimensions")

    return embeddings


def store_embeddings(
    conn,
    db_type: str,
    composite_keys: List[Tuple[str, str, str]],
    embeddings: np.ndarray,
    batch_size: int = 5000
):
    """Store embeddings in study_embeddings table using fast bulk operations.

    Args:
        conn: Database connection
        db_type: 'sqlite' or 'postgres'
        composite_keys: List of (study_accession, snps, strongest_snp_risk_allele) tuples
        embeddings: numpy array of embeddings
        batch_size: Batch size for bulk inserts (default: 5000)
    """
    cursor = conn.cursor()

    print(f"💾 Storing embeddings in study_embeddings table...")
    print(f"   Using bulk insert with batch size: {batch_size}")

    total = len(composite_keys)

    if db_type == 'postgres':
        # PostgreSQL: Use execute_values for optimal bulk insert performance
        print(f"   Using PostgreSQL execute_values (optimized for speed)")
        print(f"   Single transaction with batched inserts")

        # Larger batch size for better performance (fewer round-trips)
        chunk_size = 10000  # 10K rows per batch

        # Prepare data tuples
        print(f"   Preparing data tuples...")
        data_tuples = []
        for (study_acc, snps, risk_allele), emb in tqdm(zip(composite_keys, embeddings), total=total, desc="Preparing data"):
            # Format: (study_accession, snps, strongest_snp_risk_allele, embedding_json)
            embedding_json = json.dumps(emb.tolist(), separators=(',', ':'))
            data_tuples.append((study_acc, snps, risk_allele, embedding_json))

        # Use execute_values for bulk insert (much faster than multiple INSERTs)
        print(f"   Uploading in batches of {chunk_size}...")

        # Process in chunks with progress bar
        for i in tqdm(range(0, len(data_tuples), chunk_size), desc="Uploading batches"):
            chunk = data_tuples[i:i+chunk_size]

            psycopg2.extras.execute_values(
                cursor,
                """
                INSERT INTO study_embeddings (study_accession, snps, strongest_snp_risk_allele, embedding, created_at, updated_at)
                VALUES %s
                ON CONFLICT (study_accession, snps, strongest_snp_risk_allele) DO NOTHING
                """,
                chunk,
                template="(%s, %s, %s, %s, NOW(), NOW())",
                page_size=chunk_size
            )

        # Single commit at the end (much faster than committing after every batch)
        print(f"   Committing transaction...")
        conn.commit()

    else:
        # SQLite: Use executemany for batch inserts
        print(f"   Using SQLite executemany")

        for i in tqdm(range(0, total, batch_size), desc="Uploading batches"):
            batch_keys = composite_keys[i:i+batch_size]
            batch_embeddings = embeddings[i:i+batch_size]

            # Prepare batch data
            batch_data = [
                (study_acc, snps, risk_allele, json.dumps(emb.tolist()), json.dumps(emb.tolist()))
                for (study_acc, snps, risk_allele), emb in zip(batch_keys, batch_embeddings)
            ]

            # Bulk insert
            cursor.executemany(
                """
                INSERT INTO study_embeddings (study_accession, snps, strongest_snp_risk_allele, embedding, created_at, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                ON CONFLICT(study_accession, snps, strongest_snp_risk_allele) DO UPDATE
                SET embedding = ?, updated_at = datetime('now')
                """,
                batch_data
            )

            conn.commit()

    print(f"✅ Stored {total} embeddings in study_embeddings table")
    print(f"   Using stable composite key (study_accession, snps, strongest_snp_risk_allele)")


def save_embeddings_to_file(filepath: str, composite_keys: List[Tuple[str, str, str]], embeddings: np.ndarray):
    """Save embeddings to a local .npz file for backup or reuse.

    Args:
        filepath: Path to save the .npz file
        composite_keys: List of (study_accession, snps, strongest_snp_risk_allele) tuples
        embeddings: numpy array of embeddings
    """
    print(f"💾 Saving embeddings to local file: {filepath}")

    # Convert composite keys to separate arrays for storage
    study_accessions = np.array([k[0] for k in composite_keys], dtype=object)
    snps = np.array([k[1] for k in composite_keys], dtype=object)
    risk_alleles = np.array([k[2] for k in composite_keys], dtype=object)

    # Save composite keys and embeddings
    np.savez_compressed(
        filepath,
        study_accessions=study_accessions,
        snps=snps,
        risk_alleles=risk_alleles,
        embeddings=embeddings,
        dimensions=embeddings.shape[1]
    )

    file_size_mb = os.path.getsize(filepath) / 1024 / 1024
    print(f"✅ Embeddings saved successfully")
    print(f"   File: {filepath}")
    print(f"   Size: {file_size_mb:.1f} MB (compressed)")
    print(f"   Studies: {len(composite_keys)}")
    print(f"   Dimensions: {embeddings.shape[1]}")


def load_embeddings_from_file(filepath: str) -> Tuple[List[Tuple[str, str, str]], np.ndarray]:
    """Load embeddings from a local .npz file.

    Args:
        filepath: Path to the .npz file

    Returns:
        Tuple of (composite_keys, embeddings) where composite_keys are (study_accession, snps, strongest_snp_risk_allele) tuples
    """
    print(f"📂 Loading embeddings from local file: {filepath}")

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    # Load the compressed file
    data = np.load(filepath, allow_pickle=True)
    embeddings = data['embeddings']
    dimensions = int(data['dimensions'])

    # Handle both old and new formats
    if 'study_keys' in data:
        # Old format: pipe-delimited keys (study_accession|snps|strongest_snp_risk_allele)
        print(f"   Detected old format with pipe-delimited keys")
        study_keys = data['study_keys'].tolist()
        composite_keys = []
        for key in study_keys:
            parts = key.split('|')
            if len(parts) == 3:
                composite_keys.append((parts[0], parts[1], parts[2]))
            else:
                raise ValueError(f"Invalid study_key format: {key} (expected 3 parts, got {len(parts)})")
    elif 'study_accessions' in data:
        # New format: separate arrays for each component
        print(f"   Detected new format with separate arrays")
        study_accessions = data['study_accessions'].tolist()
        snps = data['snps'].tolist()
        risk_alleles = data['risk_alleles'].tolist()
        composite_keys = list(zip(study_accessions, snps, risk_alleles))
    else:
        raise ValueError("Invalid file format: missing 'study_keys' or 'study_accessions' key")

    print(f"✅ Embeddings loaded successfully")
    print(f"   Studies: {len(composite_keys)}")
    print(f"   Dimensions: {dimensions}")
    print(f"   Shape: {embeddings.shape}")

    return composite_keys, embeddings


def main():
    parser = argparse.ArgumentParser(
        description="Generate embeddings for GWAS catalog studies"
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=512,
        help='Batch size for embedding generation (adjust based on GPU VRAM, default: 512)'
    )
    parser.add_argument(
        '--dimensions',
        type=int,
        default=512,
        choices=[128, 256, 512, 768],
        help='Number of dimensions to keep (default: 512 for 33%% storage savings)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Limit number of studies to process (for testing)'
    )
    parser.add_argument(
        '--upload-batch-size',
        type=int,
        default=1000,
        help='Batch size for database uploads (default: 1000)'
    )
    parser.add_argument(
        '--save-local',
        type=str,
        default=None,
        help='Save embeddings to local file (e.g., embeddings_backup.npz)'
    )
    parser.add_argument(
        '--load-local',
        type=str,
        default=None,
        help='Load embeddings from local file and upload to database'
    )

    args = parser.parse_args()

    print("=" * 60)
    print("🚀 GWAS Catalog Embedding Generator (Decoupled)")
    print("=" * 60)

    # Check if loading from local file
    if args.load_local:
        print(f"\n📂 Load mode: Using embeddings from {args.load_local}")

        # Load embeddings from file
        try:
            composite_keys, embeddings = load_embeddings_from_file(args.load_local)
        except Exception as e:
            print(f"❌ Failed to load embeddings: {e}")
            sys.exit(1)

        # Get database connection
        postgres_conn_str = os.environ.get('POSTGRES_DB')

        try:
            conn, db_type = get_db_connection(postgres_conn_str)
            print(f"✅ Connected to {db_type.upper()} database")
        except Exception as e:
            print(f"❌ Database connection failed: {e}")
            sys.exit(1)

        # Store embeddings in database
        print(f"\n💾 Uploading embeddings to study_embeddings table...")
        try:
            store_embeddings(
                conn=conn,
                db_type=db_type,
                composite_keys=composite_keys,
                embeddings=embeddings,
                batch_size=args.upload_batch_size
            )
        except Exception as e:
            print(f"❌ Failed to store embeddings: {e}")
            conn.rollback()
            conn.close()
            sys.exit(1)

        # Close connection
        conn.close()

        print("\n" + "=" * 60)
        print("✅ Embeddings loaded and uploaded successfully!")
        print("=" * 60)
        print(f"   Loaded from: {args.load_local}")
        print(f"   Uploaded to: {db_type.upper()} database")
        print(f"   Total studies: {len(composite_keys)}")
        print("=" * 60)
        sys.exit(0)

    # Otherwise, generate embeddings from scratch
    print(f"\n🔥 Generate mode: Creating new embeddings from database")

    # Get database connection
    postgres_conn_str = os.environ.get('POSTGRES_DB')

    try:
        conn, db_type = get_db_connection(postgres_conn_str)
        print(f"✅ Connected to {db_type.upper()} database")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)

    # Load embedding model
    print(f"\n📥 Loading embedding model...")
    print(f"   This may take a few minutes on first run (downloads ~550 MB)")

    try:
        model = SentenceTransformer(
            'nomic-ai/nomic-embed-text-v1.5',
            trust_remote_code=True
        )
        print(f"✅ Model loaded successfully")
        print(f"   Max sequence length: {model.max_seq_length} tokens")
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        print(f"\nMake sure you have installed required packages:")
        print(f"  pip install sentence-transformers torch")
        sys.exit(1)

    # Fetch studies
    print(f"\n📚 Fetching studies without embeddings...")
    try:
        studies = fetch_studies(conn, db_type, limit=args.limit)

        if not studies:
            print(f"✅ All studies already have embeddings!")
            conn.close()
            sys.exit(0)

    except Exception as e:
        print(f"❌ Failed to fetch studies: {e}")
        conn.close()
        sys.exit(1)

    # Extract composite keys and texts
    composite_keys = [(s[0], s[1], s[2]) for s in studies]
    texts = [s[3] for s in studies]

    # Generate embeddings
    print(f"\n🔥 Generating embeddings on GPU...")
    print(f"   This will take ~20-60 minutes for 1M studies")
    print(f"   Time estimate: ~{len(texts) * 0.05 / 60:.1f} minutes\n")

    try:
        embeddings = generate_embeddings(
            model=model,
            texts=texts,
            batch_size=args.batch_size,
            dimensions=args.dimensions
        )

        print(f"✅ Generated {embeddings.shape[0]} embeddings")
        print(f"   Shape: {embeddings.shape}")
        print(f"   Size: ~{embeddings.nbytes / 1024 / 1024:.1f} MB")

    except Exception as e:
        print(f"❌ Failed to generate embeddings: {e}")
        conn.close()
        sys.exit(1)

    # Save to local file if requested
    if args.save_local:
        print(f"\n💾 Saving embeddings to local file...")
        try:
            save_embeddings_to_file(args.save_local, composite_keys, embeddings)
        except Exception as e:
            print(f"⚠️  Warning: Failed to save embeddings locally: {e}")
            print(f"   Continuing with database upload...")

    # Store embeddings in separate table
    print(f"\n💾 Uploading embeddings to study_embeddings table...")
    try:
        store_embeddings(
            conn=conn,
            db_type=db_type,
            composite_keys=composite_keys,
            embeddings=embeddings,
            batch_size=args.upload_batch_size
        )
    except Exception as e:
        print(f"❌ Failed to store embeddings: {e}")
        conn.rollback()
        conn.close()
        sys.exit(1)

    # Close connection
    conn.close()

    print("\n" + "=" * 60)
    print("✅ Embedding generation complete!")
    print("=" * 60)
    print(f"   Total studies processed: {len(studies)}")
    print(f"   Dimensions: {args.dimensions}")
    print(f"   Database: {db_type.upper()}")
    print(f"   Storage: Separate study_embeddings table")
    if args.save_local:
        print(f"   Local backup: {args.save_local}")
    print("\n✨ Benefits of separate table:")
    print("   • Can reload gwas_catalog without affecting embeddings")
    print("   • Can regenerate embeddings independently")
    print("   • Cleaner separation of concerns")
    if args.save_local:
        print("\n📦 Local backup created:")
        print(f"   • Reuse: python scripts/generate-embeddings.py --load-local {args.save_local}")
        print(f"   • Upload to new DB: POSTGRES_DB='...' python scripts/generate-embeddings.py --load-local {args.save_local}")
    print("\nNext steps:")
    print("   1. Embeddings are stored in study_embeddings table")
    print("   2. Deploy application with semantic search enabled")
    print("   3. Test semantic search queries")
    print("=" * 60)


if __name__ == '__main__':
    main()
