#!/usr/bin/env node
/**
 * Remove duplicate Beds24 message rows created by the old sync bug.
 *
 * Duplicates share (event_id, sender, text, created_at) — the old code
 * parsed the same Beds24 timestamp on every poll and re-inserted the row.
 *
 * Strategy: within each duplicate group, keep one row (prefer the one
 * with beds24_message_id set; otherwise the oldest by id) and delete
 * the rest.
 *
 * Usage:
 *   node scripts/dedupe-messages.mjs           # dry run, prints counts
 *   node scripts/dedupe-messages.mjs --apply   # actually delete
 */
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

const apply = process.argv.includes('--apply');

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
  const groupsRes = await client.query(`
    SELECT event_id, sender, text, created_at, COUNT(*) AS cnt
    FROM messages
    WHERE event_id IS NOT NULL
    GROUP BY event_id, sender, text, created_at
    HAVING COUNT(*) > 1
  `);

  const groups = groupsRes.rows;
  const totalDupRows = groups.reduce((sum, g) => sum + Number(g.cnt) - 1, 0);

  console.log(`중복 그룹: ${groups.length}건`);
  console.log(`삭제 예정 행: ${totalDupRows}건`);

  if (groups.length === 0) {
    console.log('중복 없음 — 정리할 게 없습니다.');
  } else if (!apply) {
    console.log('\n예시 (최대 5건):');
    for (const g of groups.slice(0, 5)) {
      const preview = String(g.text).slice(0, 40).replace(/\s+/g, ' ');
      console.log(`  ${g.cnt}× [${g.sender}] ${preview}…  @ ${g.created_at.toISOString?.() ?? g.created_at}`);
    }
    console.log('\n실제 삭제하려면 --apply 플래그를 붙이세요.');
  } else {
    await runDelete(groups);
  }
} finally {
  await client.end();
}

async function runDelete(groups) {
  await client.query('BEGIN');
  let deleted = 0;
  try {
    for (const g of groups) {
      // For each group, pick the row to keep:
      //   - first preference: a row that already has beds24_message_id
      //   - fallback: the lexicographically smallest id (stable, deterministic)
      const rowsRes = await client.query(
        `SELECT id, beds24_message_id
         FROM messages
         WHERE event_id = $1 AND sender = $2 AND text = $3 AND created_at = $4
         ORDER BY (beds24_message_id IS NULL), id`,
        [g.event_id, g.sender, g.text, g.created_at]
      );
      const rows = rowsRes.rows;
      if (rows.length <= 1) continue;
      const keepId = rows[0].id;
      const deleteIds = rows.slice(1).map(r => r.id);
      const res = await client.query(
        `DELETE FROM messages WHERE id = ANY($1::text[])`,
        [deleteIds]
      );
      deleted += res.rowCount ?? 0;
      void keepId;
    }
    await client.query('COMMIT');
    console.log(`\n완료: ${deleted}건 삭제됨`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
