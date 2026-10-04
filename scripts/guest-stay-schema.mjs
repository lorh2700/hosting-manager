// Read-only by default. --apply installs only the five new guest-app tables.
import { config } from 'dotenv';
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

config({ path: '.env.local', quiet: true });
const expected = { guest_stay_accesses: 14, guest_stay_sessions: 6, guest_stay_requests: 16, guest_stay_attempts: 3, guest_stay_devices: 11 };
const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 6543), database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp', password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000, query_timeout: 15000,
});
try {
  await client.connect();
  if (process.argv.includes('--apply')) {
    const migration = await readFile(new URL('../prisma/migrations/20261002140000_guest_stays/migration.sql', import.meta.url), 'utf8');
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('void-guest-stay-schema'))");
    await client.query(migration);
  }
  const { rows } = await client.query(`SELECT c.relname AS name, c.relrowsecurity AS protected,
    (SELECT count(*)::int FROM information_schema.columns col WHERE col.table_schema='public' AND col.table_name=c.relname) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [Object.keys(expected)]);
  const complete = rows.length === Object.keys(expected).length && rows.every(row => row.protected && row.columns === expected[row.name]);
  if (process.argv.includes('--apply')) {
    if (!complete) throw new Error('Incomplete guest-stay schema');
    await client.query('COMMIT');
  }
  console.log(JSON.stringify({ complete, tables: rows }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Guest-stay schema check failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
