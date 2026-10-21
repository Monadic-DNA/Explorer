import { readFile } from 'node:fs/promises';
import pg from 'pg';
if(!process.env.POSTGRES_DB)throw new Error('Set POSTGRES_DB to the intended environment database.');
const host=new URL(process.env.POSTGRES_DB).hostname;
const ssl=['localhost','127.0.0.1','[::1]'].includes(host)?false:{rejectUnauthorized:true,...(process.env.DATABASE_CA_CERT?{ca:process.env.DATABASE_CA_CERT}:{})};
const client=new pg.Client({connectionString:process.env.POSTGRES_DB,ssl});
try{await client.connect();await client.query(await readFile(new URL('../migrations/002-encrypted-vault-sync.sql',import.meta.url),'utf8'));console.log('Encrypted sync schema applied.');}finally{await client.end();}
