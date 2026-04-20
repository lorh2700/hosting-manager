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
  console.log(`\n=== properties ===`);
  const props = await client.query(`SELECT id, name FROM properties ORDER BY name`);
  for (const r of props.rows) console.log(`  ${r.name.padEnd(20)} id=${r.id}`);

  console.log(`\n=== bookings covering ${date} (checkin ≤ d ≤ checkout) ===`);
  const bookings = await client.query(
    `SELECT b.id, b.check_in, b.check_out, b.status, p.name AS property
     FROM bookings b
     LEFT JOIN properties p ON p.id = b.property_id
     WHERE b.check_in::text <= $1 AND b.check_out::text >= $1
     ORDER BY p.name, b.check_in`,
    [date]
  );
  if (!bookings.rowCount) console.log('  (none)');
  for (const r of bookings.rows) {
    console.log(`  ${r.property?.padEnd(20) ?? '(unknown)'} ${r.check_in} → ${r.check_out}  ${r.status ?? ''}`);
  }

  console.log(`\n=== events covering ${date} ===`);
  const events = await client.query(
    `SELECT e.id, e.start_date, e.end_date, e.type, e.source, e.title, p.name AS property
     FROM events e
     LEFT JOIN properties p ON p.id = e.property_id
     WHERE e.start_date <= $1 AND e.end_date >= $1
     ORDER BY p.name, e.start_date`,
    [date]
  );
  if (!events.rowCount) console.log('  (none)');
  for (const r of events.rows) {
    console.log(`  ${r.property?.padEnd(20) ?? '(unknown)'} ${r.start_date} → ${r.end_date}  ${r.type}/${r.source ?? ''}  ${r.title ?? ''}`);
  }

  console.log(`\n=== cleanings on ${date} ===`);
  const cleanings = await client.query(
    `SELECT c.id, c.is_open, c.cleaner_id, c.status, p.name AS property
     FROM cleanings c
     LEFT JOIN properties p ON p.id = c.property_id
     WHERE c.date::text = $1
     ORDER BY p.name`,
    [date]
  );
  if (!cleanings.rowCount) console.log('  (none)');
  for (const r of cleanings.rows) {
    console.log(`  ${r.property?.padEnd(20) ?? '(unknown)'} isOpen=${r.is_open ? 'Y' : 'N'} cleaner=${r.cleaner_id ?? '(none)'} ${r.status}`);
  }
} finally {
  await client.end();
}
