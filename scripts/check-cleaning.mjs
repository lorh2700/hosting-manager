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

const date = process.argv[2] ?? '2026-05-05';

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
    `SELECT c.id, c.date, c.is_open, c.cleaner_id, c.status, c.notes, p.name AS property
     FROM cleanings c
     LEFT JOIN properties p ON p.id = c.property_id
     WHERE c.date::text = $1
     ORDER BY p.name`,
    [date]
  );
  console.log(`\n=== ${date} 청소 ${rows.length}건 ===`);
  for (const r of rows) {
    console.log(
      `  ${r.property?.padEnd(20) ?? '(unknown)'} | isOpen=${r.is_open ? 'Y' : 'N'} | cleaner=${r.cleaner_id ?? '(미배정)'} | ${r.status} | ${r.notes ?? ''}`
    );
  }
} finally {
  await client.end();
}
