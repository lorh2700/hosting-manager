// Apply only the backwards-compatible column needed by the stay option feature.
// Default is read-only; --apply explicitly performs the additive migration.
import { config } from 'dotenv';
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
config({ path: '.env.local', quiet: true });
const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 6543), database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp', password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  if (process.argv.includes('--apply')) {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(await readFile(new URL('../prisma/migrations/20260913010000_checkout_stay_options/migration.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
  }
  const result = await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'checkout_orders' AND column_name = 'stay_options'");
  console.log(JSON.stringify({ stayOptionsColumn: result.rows }));
} catch (error) {
  console.error('Stay options schema check failed:', error.code || error.name);
  process.exitCode = 1;
} finally { await client.end(); }
