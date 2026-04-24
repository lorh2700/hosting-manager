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

const CHANNEL_NAME = process.argv[2] ?? 'iCal Import 1';

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

console.log(`\n=== 채널 이름 "${CHANNEL_NAME}" 관련 데이터 조회 ===\n`);

// events: source 또는 title 에 채널 이름이 들어간 것
const ev = await client.query(
  `SELECT e.id, e.property_id, e.channel_id, e.title, e.start_date, e.end_date, e.type, e.source, e.original_uid,
          p.name as property_name
   FROM events e
   LEFT JOIN properties p ON p.id = e.property_id
   WHERE e.source = $1 OR e.title = $1
   ORDER BY p.name, e.start_date`,
  [CHANNEL_NAME]
);
console.log(`[events with source/title = "${CHANNEL_NAME}"] ${ev.rows.length}건`);
const byProp = new Map();
for (const e of ev.rows) {
  const key = `${e.property_name ?? '(unknown)'} (${e.property_id})`;
  if (!byProp.has(key)) byProp.set(key, []);
  byProp.get(key).push(e);
}
for (const [propKey, rows] of byProp.entries()) {
  console.log(`\n  ▸ ${propKey} — ${rows.length}건`);
  for (const e of rows) {
    console.log(`     ${e.start_date}~${e.end_date}  channel_id=${e.channel_id ?? '-'}  source=${e.source ?? '-'}  title=${e.title ?? '-'}  uid=${e.original_uid ?? '-'}`);
  }
}

// PropertyChannel 테이블에도 같은 이름이 있는지 확인
const channels = await client.query(
  `SELECT id, property_id, name, import_url, export_url, is_active
   FROM property_channels WHERE name = $1`,
  [CHANNEL_NAME]
);
console.log(`\n[property_channels] ${channels.rows.length}건`);
for (const c of channels.rows) {
  console.log(`  - id=${c.id}  property=${c.property_id}  active=${c.is_active}`);
}

await client.end();
console.log('\n=== done ===\n');
