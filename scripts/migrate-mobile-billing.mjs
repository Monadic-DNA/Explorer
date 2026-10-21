import { readFile } from 'node:fs/promises';
import pg from 'pg';
const connectionString = process.env.POSTGRES_DB;
if (!connectionString) throw new Error('Set POSTGRES_DB to the intended environment database.');
const local = ['localhost','127.0.0.1','::1'].includes(new URL(connectionString).hostname);
const ssl = local ? false : { rejectUnauthorized:true, ...(process.env.DATABASE_CA_CERT ? {ca:process.env.DATABASE_CA_CERT} : {}) };
const client = new pg.Client({ connectionString, ssl });
try { await client.connect(); await client.query(await readFile(new URL('../migrations/001-mobile-billing.sql',import.meta.url),'utf8')); console.log('Mobile billing schema applied.'); }
finally { await client.end(); }
