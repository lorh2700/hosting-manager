#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile(path.join(repoRoot, '.env.local'));
loadEnvFile(path.join(repoRoot, '.env'));

const id = process.argv[2];
if (!id) { console.error('usage: node scripts/check-cleaner.mjs <cleaner_id>'); process.exit(1); }

const { Client } = pg;
const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

await client.connect();
try {
  const { rows } = await client.query(
    `SELECT id, name, phone, user_id FROM cleaners WHERE id = $1`,
    [id]
  );
  console.log(rows[0] ?? '(not found)');
} finally {
  await client.end();
}
