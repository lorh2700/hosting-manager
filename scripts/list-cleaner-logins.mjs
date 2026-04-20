#!/usr/bin/env node
/**
 * List cleaners that already have a linked login account, plus cleaners
 * that can auto-create one from their phone number.
 *
 * Usage:
 *   node scripts/list-cleaner-logins.mjs              # list-only
 *   node scripts/list-cleaner-logins.mjs --create-missing
 *     ↑ creates login accounts for cleaners with phone but no linked User.
 *       Password = last 4 digits of the phone.
 *
 * Reads DB creds from .env (DATABASE_URL preferred, else DB_* vars).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';

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

function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) digits = '0' + digits.slice(2);
  if (digits.length < 9 || digits.length > 11) return null;
  return digits;
}
const last4 = (p) => { const n = normalizePhone(p); return n && n.length >= 4 ? n.slice(-4) : null; };
const syntheticEmail = (p) => { const n = normalizePhone(p); return n ? `${n}@cleaner.va` : null; };

function makeClient() {
  const { Client } = pg;
  if (process.env.DATABASE_URL) {
    return new Client({ connectionString: process.env.DATABASE_URL });
  }
  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

async function main() {
  const createMissing = process.argv.includes('--create-missing');
  const client = makeClient();
  await client.connect();

  try {
    const { rows: cleaners } = await client.query(`
      SELECT c.id, c.name, c.phone, c.user_id, u.email AS user_email
      FROM cleaners c
      LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at ASC
    `);

    const ready = [], needsAccount = [], noPhone = [];
    for (const c of cleaners) {
      if (!c.phone) noPhone.push(c);
      else if (c.user_id && c.user_email) ready.push(c);
      else needsAccount.push(c);
    }

    console.log('\n=== 로그인 가능한 청소업자 ===');
    if (!ready.length) console.log('  (없음)');
    else for (const c of ready) {
      console.log(`  ${String(c.name).padEnd(10)} | 전화: ${normalizePhone(c.phone)}  비번(뒷4자리): ${last4(c.phone)}  | email: ${c.user_email}`);
    }

    console.log('\n=== 계정 미생성 (전화번호는 있음) ===');
    if (!needsAccount.length) console.log('  (없음)');
    else {
      for (const c of needsAccount) {
        console.log(`  ${String(c.name).padEnd(10)} | 전화: ${normalizePhone(c.phone)}  | 뒷4자리: ${last4(c.phone)}`);
      }
      if (createMissing) {
        console.log('\n--- 계정 생성 중 ---');
        for (const c of needsAccount) {
          const email = syntheticEmail(c.phone);
          const pw = last4(c.phone);
          const normalized = normalizePhone(c.phone);
          if (!email || !pw) { console.log(`  SKIP ${c.name}: 전화번호 형식 오류`); continue; }

          const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
          let userId;
          if (existing.rowCount) {
            userId = existing.rows[0].id;
            console.log(`  LINK ${c.name}: ${email} (기존 User 재사용)`);
          } else {
            const hashed = await bcrypt.hash(pw, 12);
            userId = randomUUID();
            await client.query(
              `INSERT INTO users (id, email, password, display_name, phone, role, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 'cleaner', 'active', NOW(), NOW())`,
              [userId, email, hashed, c.name, normalized]
            );
            console.log(`  OK   ${c.name}: ${email}  비번=${pw}`);
          }
          await client.query('UPDATE cleaners SET user_id = $1, phone = $2 WHERE id = $3', [userId, normalized, c.id]);
        }
      } else {
        console.log('\n  ↑ 일괄 생성: node scripts/list-cleaner-logins.mjs --create-missing');
      }
    }

    console.log('\n=== 전화번호 미등록 ===');
    if (!noPhone.length) console.log('  (없음)');
    else for (const c of noPhone) console.log(`  ${c.name}  (관리자 UI에서 전화번호 먼저 등록 필요)`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
