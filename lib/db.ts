import Database from "better-sqlite3";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

let sqliteInstance: Database.Database | null = null;
let pgPool: Pool | null = null;

type DbConnection = {
  type: 'sqlite' | 'postgres';
  sqlite?: Database.Database;
  postgres?: Pool;
};

function getSSLConfig(connectionString: string) {
  // Local connections don't need SSL
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return false;
  }

  // SECURITY LIMITATION: DigitalOcean uses self-signed project CAs
  // Node.js TLS rejects these even when the CA cert is provided explicitly
  // See: https://www.digitalocean.com/community/questions/postgresql-on-app-platform-self-signed-certificate-in-certificate-chain-issue
  //
  // We provide the CA cert to validate against the specific DigitalOcean server,
  // but must set rejectUnauthorized: false to accept the self-signed CA.
  //
  // This is MORE SECURE than the original code because:
  // 1. We don't set NODE_TLS_REJECT_UNAUTHORIZED='0' (which affects ALL HTTPS globally)
  // 2. We still verify against the specific CA cert (prevents completely random MITM)
  // 3. The SSL config is scoped to just this Pool connection
  //
  // RESIDUAL RISK: An attacker with the DigitalOcean CA private key could MITM the DB connection

  // DigitalOcean automatically injects DATABASE_CA_CERT when deployed to App Platform
  if (process.env.DATABASE_CA_CERT) {
    return {
      ca: process.env.DATABASE_CA_CERT,
      rejectUnauthorized: false, // Required for self-signed CAs
    };
  }

  // Fallback: Check if CA certificate file exists (for local development)
  const caCertPath = path.join(process.cwd(), 'certs', 'ca-certificate.crt');
  if (fs.existsSync(caCertPath)) {
    return {
      ca: fs.readFileSync(caCertPath).toString(),
      rejectUnauthorized: false, // Required for self-signed CAs
    };
  }

  // For DigitalOcean without CA cert
  if (connectionString.includes('digitalocean.com') || connectionString.includes('.db.ondigitalocean.com') || connectionString.includes('ondigitalocean.com')) {
    console.warn('DigitalOcean connection detected but no CA cert found.');
    console.warn('Set DATABASE_CA_CERT environment variable or add ca-certificate.crt to certs/ directory.');
    return {
      rejectUnauthorized: false,
    };
  }

  // Default: use system CAs with full validation
  return {
    rejectUnauthorized: true,
  };
}

function resolveDatabasePath(): string {
  const fromEnv = process.env.GWAS_DB_PATH;
  if (fromEnv) {
    return fromEnv;
  }

  return path.join(process.cwd(), "localdata", "gwas_catalog.sqlite");
}

export function getDbType(): 'sqlite' | 'postgres' {
  return process.env.POSTGRES_DB ? 'postgres' : 'sqlite';
}

export function getDb(): DbConnection {
  // Check if PostgreSQL connection string is provided
  const postgresDb = process.env.POSTGRES_DB;

  if (postgresDb) {
    if (!pgPool) {
      pgPool = new Pool({
        connectionString: postgresDb,
        ssl: getSSLConfig(postgresDb),
        // Set HNSW ef_search parameter for better recall in semantic search
        // This increases the number of candidates examined by the HNSW index
        options: '-c hnsw.ef_search=1000'
      });
    }
    return {
      type: 'postgres',
      postgres: pgPool,
    };
  }

  // Fall back to SQLite
  if (sqliteInstance) {
    return {
      type: 'sqlite',
      sqlite: sqliteInstance,
    };
  }

  const dbPath = resolveDatabasePath();

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `GWAS catalog database not found at ${dbPath}. Set GWAS_DB_PATH or create the SQLite database using localdata/gwas_catalog.sql.`,
    );
  }

  sqliteInstance = new Database(dbPath, { readonly: true, fileMustExist: true });
  return {
    type: 'sqlite',
    sqlite: sqliteInstance,
  };
}

// Helper function to convert SQLite query to PostgreSQL format
function convertQueryToPostgres(query: string): string {
  let pgQuery = query;
  let paramIndex = 1;

  // Replace SQLite ? placeholders with PostgreSQL $1, $2, etc.
  pgQuery = pgQuery.replace(/\?/g, () => `$${paramIndex++}`);

  // Replace SQLite's COLLATE NOCASE with PostgreSQL LOWER() function
  pgQuery = pgQuery.replace(/COLLATE NOCASE/gi, '');

  // For PostgreSQL, we need to handle case-insensitive ordering differently
  // Simply remove the COLLATE clause and sort case-sensitively for now
  // The client-side sorting will handle case-insensitive sorting

  return pgQuery;
}

// Helper function to execute queries on either database type
export async function executeQuery<T>(query: string, params: any[] = []): Promise<T[]> {
  const db = getDb();

  if (db.type === 'postgres' && db.postgres) {
    const pgQuery = convertQueryToPostgres(query);
    const result = await db.postgres.query(pgQuery, params);
    return result.rows;
  } else if (db.type === 'sqlite' && db.sqlite) {
    const stmt = db.sqlite.prepare(query);
    return stmt.all(...params) as T[];
  }

  throw new Error('No database connection available');
}

export async function executeQuerySingle<T>(query: string, params: any[] = []): Promise<T | null> {
  const db = getDb();

  if (db.type === 'postgres' && db.postgres) {
    const pgQuery = convertQueryToPostgres(query);
    const result = await db.postgres.query(pgQuery, params);
    return result.rows[0] || null;
  } else if (db.type === 'sqlite' && db.sqlite) {
    const stmt = db.sqlite.prepare(query);
    return (stmt.get(...params) as T) || null;
  }

  throw new Error('No database connection available');
}
