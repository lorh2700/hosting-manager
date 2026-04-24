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
  console.log(`\n=== all properties ===`);
  const props = await client.query(`SELECT id, name, beds24_prop_id FROM properties ORDER BY name`);
  for (const r of props.rows) console.log(`  ${r.name.padEnd(20)} id=${r.id} beds24=${r.beds24_prop_id ?? '-'}`);

  console.log(`\n=== event source distribution by property (last 180 days + future) ===`);
  const dist = await client.query(
    `SELECT p.name, e.source, count(*) AS cnt
     FROM events e
     LEFT JOIN properties p ON p.id = e.property_id
     WHERE e.type='reservation'
       AND e.start_date >= (CURRENT_DATE - INTERVAL '180 days')::text
     GROUP BY p.name, e.source
     ORDER BY p.name, cnt DESC`
  );
  if (!dist.rowCount) console.log('  (none)');
  for (const r of dist.rows) {
    console.log(`  ${(r.name ?? '?').padEnd(20)} ${(r.source ?? 'null').padEnd(20)} ${r.cnt}`);
  }

  console.log(`\n=== sample Dowonjae events ===`);
  const dw = await client.query(
    `SELECT e.start_date, e.end_date, e.source, e.title, e.original_uid
     FROM events e
     LEFT JOIN properties p ON p.id = e.property_id
     WHERE p.name ILIKE '%도원재%' OR p.name ILIKE '%dowon%'
     ORDER BY e.start_date DESC
     LIMIT 30`
  );
  if (!dw.rowCount) console.log('  (no 도원재 property found by name match)');
  for (const r of dw.rows) {
    console.log(`  ${r.start_date}→${r.end_date} src=${(r.source ?? 'null').padEnd(15)} uid=${(r.original_uid ?? '-').padEnd(12)} "${r.title ?? ''}"`);
  }
} finally {
  await client.end();
}
