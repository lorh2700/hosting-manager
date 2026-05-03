// One-off diagnostic: inspect 5/16 Unwadang cleanings + scope rules.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import pkg from 'pg';
const { Client } = pkg;

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

const TARGET_DATE = '2026-05-16';

console.log(`\n=== 5/16 cleanings (모든 숙소) ===`);
const all = await client.query(`
  SELECT
    c.id,
    c.date,
    p.id   AS property_id,
    p.name AS property_name,
    p.owner_id AS property_owner_id,
    c.cleaner_id,
    cl.name AS assigned_cleaner,
    c.is_open,
    c.status,
    c.created_at
  FROM cleanings c
  LEFT JOIN properties p ON p.id = c.property_id
  LEFT JOIN cleaners cl ON cl.id = c.cleaner_id
  WHERE c.date = $1
  ORDER BY p.name, c.created_at
`, [TARGET_DATE]);

if (all.rows.length === 0) {
  console.log('  (없음)');
} else {
  for (const r of all.rows) {
    console.log(`  • ${r.property_name ?? '(unknown)'}`);
    console.log(`    cleaning_id     = ${r.id}`);
    console.log(`    property_id     = ${r.property_id}`);
    console.log(`    property_owner  = ${r.property_owner_id}`);
    console.log(`    cleaner_id      = ${r.cleaner_id ?? 'NULL'}`);
    console.log(`    assigned        = ${r.assigned_cleaner ?? '(none)'}`);
    console.log(`    is_open         = ${r.is_open}`);
    console.log(`    status          = ${r.status}`);
    console.log(`    created_at      = ${r.created_at.toISOString()}`);
    console.log('');
  }
}

console.log(`\n=== 운와당 모든 청소 row (전체 기간) — 전체 N=`);
const unwadang = await client.query(`
  SELECT id FROM properties
  WHERE name ILIKE '%운와당%' OR name ILIKE '%unwadang%'
`);
for (const p of unwadang.rows) {
  const list = await client.query(`
    SELECT date, cleaner_id, is_open, status
    FROM cleanings
    WHERE property_id = $1
    ORDER BY date DESC
    LIMIT 20
  `, [p.id]);
  console.log(`property ${p.id} 최근 청소 ${list.rows.length}건:`);
  for (const r of list.rows) {
    console.log(`  ${r.date}  cleaner=${r.cleaner_id ?? 'NULL'}  is_open=${r.is_open}  status=${r.status}`);
  }
}

console.log(`\n=== 청소 담당자 (cleaners) 목록 — 권한 범위 ===`);
const cleaners = await client.query(`
  SELECT
    cl.id,
    cl.name,
    cl.user_id,
    cl.owner_id,
    u.email AS user_email
  FROM cleaners cl
  LEFT JOIN users u ON u.id = cl.user_id
  ORDER BY cl.name
`);
for (const c of cleaners.rows) {
  console.log(`  • ${c.name}`);
  console.log(`    cleaner_id = ${c.id}`);
  console.log(`    user_id    = ${c.user_id ?? 'NULL'}`);
  console.log(`    user_email = ${c.user_email ?? '(no account)'}`);
  console.log(`    owner_id   = ${c.owner_id}`);

  if (c.user_id) {
    const props = await client.query(`
      SELECT p.id, p.name FROM user_properties up
      JOIN properties p ON p.id = up.property_id
      WHERE up.user_id = $1
    `, [c.user_id]);
    if (props.rows.length === 0) {
      console.log(`    scoped properties: (none — sees all)`);
    } else {
      console.log(`    scoped properties: ${props.rows.map(p => p.name).join(', ')}`);
    }
  }
  console.log('');
}

await client.end();
