#!/usr/bin/env node
/**
 * For every reservation-type event, ensure a Cleaning row exists for
 * (propertyId, endDate). Newly created rows are open (isOpen=true,
 * no cleaner) so cleaners can apply to them.
 *
 * Usage:
 *   node scripts/backfill-cleanings.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
  const { rows } = await client.query(`
    SELECT DISTINCT e.property_id, e.end_date, p.name AS property
    FROM events e
    LEFT JOIN properties p ON p.id = e.property_id
    WHERE e.type = 'reservation'
    ORDER BY p.name, e.end_date
  `);

  const needed = rows.map(r => ({ propertyId: r.property_id, date: r.end_date, property: r.property }));
  console.log(`총 체크아웃 일정: ${needed.length}건`);

  const existing = await client.query(`SELECT property_id, date FROM cleanings`);
  const existingKey = new Set(existing.rows.map(r => `${r.property_id}|${r.date}`));

  const toCreate = needed.filter(n => !existingKey.has(`${n.propertyId}|${n.date}`));
  console.log(`신규 생성 필요: ${toCreate.length}건\n`);

  if (toCreate.length === 0) {
    console.log('모든 체크아웃에 이미 청소 일정이 있습니다.');
  } else {
    for (const c of toCreate) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO cleanings (id, property_id, date, status, is_open, assignment_type, has_issue, created_at)
         VALUES ($1, $2, $3, 'pending', TRUE, 'direct', FALSE, NOW())`,
        [id, c.propertyId, c.date]
      );
      console.log(`  + ${c.property?.padEnd(10) ?? '(?)'}  ${c.date}`);
    }
    console.log(`\n완료: ${toCreate.length}건 생성 (isOpen=true)`);
  }
} finally {
  await client.end();
}
