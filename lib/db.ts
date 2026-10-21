import { Pool } from "pg";
import fs from "fs";
import path from "path";

let pgPool: Pool | null = null;

function getSSLConfig(connectionString: string) {
  const hostname = new URL(connectionString).hostname;
  if (['localhost','127.0.0.1','[::1]'].includes(hostname)) return false;
  // Managed database connections must validate the server certificate, including custom project CAs.
  if (process.env.DATABASE_CA_CERT) return { ca:process.env.DATABASE_CA_CERT, rejectUnauthorized:true };
  const caCertPath = path.join(process.cwd(), 'certs', 'ca-certificate.crt');
  if (fs.existsSync(caCertPath)) return { ca:fs.readFileSync(caCertPath).toString(), rejectUnauthorized:true };
  return { rejectUnauthorized:true };
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
