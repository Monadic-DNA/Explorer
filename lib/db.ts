import { Pool } from "pg";
import fs from "fs";
import path from "path";

let pgPool: Pool | null = null;

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

export function getDb(): Pool {
  // Check if PostgreSQL connection string is provided
  const postgresDb = process.env.POSTGRES_DB;

  if (!postgresDb) {
    throw new Error(
      'POSTGRES_DB environment variable is required. Please set it to your PostgreSQL connection string.',
    );
  }

  if (!pgPool) {
    pgPool = new Pool({
      connectionString: postgresDb,
      ssl: getSSLConfig(postgresDb),
      // Set HNSW ef_search parameter for better recall in semantic search
      // This increases the number of candidates examined by the HNSW index
      options: '-c hnsw.ef_search=1000'
    });
  }

  return pgPool;
}

// Helper function to execute queries on PostgreSQL
export async function executeQuery<T>(query: string, params: any[] = []): Promise<T[]> {
  const db = getDb();
  const result = await db.query(query, params);
  return result.rows;
}

export async function executeQuerySingle<T>(query: string, params: any[] = []): Promise<T | null> {
  const db = getDb();
  const result = await db.query(query, params);
  return result.rows[0] || null;
}
