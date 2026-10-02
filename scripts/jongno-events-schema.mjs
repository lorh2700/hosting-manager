// Read-only by default. --apply adds only the new public cultural event table.
import { config } from 'dotenv';
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

config({ path: '.env.local', quiet: true });
const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 6543), database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp', password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000, query_timeout: 15000,
});

try {
  await client.connect();
  if (process.argv.includes('--apply')) {
    const source = (await readFile(new URL('../prisma/migrations/20261002020000_jongno_events/migration.sql', import.meta.url), 'utf8')).trim();
    if (!source.startsWith('BEGIN;') || !source.endsWith('COMMIT;')) throw new Error('Unexpected migration format');
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('void-jongno-events-schema'))");
    const existing = await client.query("SELECT to_regclass('public.jongno_events') IS NOT NULL AS present");
    if (!existing.rows[0].present) await client.query(source.slice('BEGIN;'.length, -'COMMIT;'.length));
    await client.query('COMMIT');
  }
  const schema = await client.query("SELECT c.relrowsecurity AS protected, (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='jongno_events') AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='jongno_events'");
  console.log(JSON.stringify({ eventStore: schema.rows[0] ?? null }));
  if (process.argv.includes('--apply') && (!schema.rows[0]?.protected || schema.rows[0].columns !== 28)) throw new Error('Incomplete event schema');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Jongno event schema check failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
