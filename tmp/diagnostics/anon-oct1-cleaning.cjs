const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 6543),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp',
  password: process.env.DB_PASSWORD || '',
  connectionTimeoutMillis: 10000,
});

async function main() {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '8s'");
  const properties = await client.query('SELECT id, name FROM properties WHERE name = $1', ['안온재']);
  const ids = properties.rows.map(row => row.id);
  const cleanings = await client.query(`SELECT id, property_id, date, status, origin, created_at, completed_at,
    cleaner_id IS NOT NULL AS has_primary, assistant_cleaner_id IS NOT NULL AS has_assistant,
    external_source, external_cleaner_name IS NOT NULL AS has_external_cleaner,
    completion_note IS NOT NULL AS has_completion_note, notes IS NOT NULL AS has_notes
    FROM cleanings WHERE property_id = ANY($1::text[]) AND date = $2`, [ids, '2026-10-01']);
  const events = await client.query(`SELECT type, start_date, end_date, channel_id,
    created_at FROM events WHERE property_id = ANY($1::text[])
    AND start_date <= $2 AND end_date >= $3 ORDER BY start_date LIMIT 20`, [ids, '2026-10-04', '2026-09-27']);
  const bookings = await client.query(`SELECT check_in, check_out, status FROM bookings
    WHERE property_id = ANY($1::text[]) AND (check_in = $2 OR check_out = $2) LIMIT 20`, [ids, '2026-10-01']);
  const audits = await client.query(`SELECT action, module, created_at FROM audit_logs
    WHERE target_id = ANY($1::text[]) OR (property_id = ANY($2::text[]) AND created_at BETWEEN $3 AND $4)
    ORDER BY created_at LIMIT 30`, [cleanings.rows.map(row => row.id), ids, '2026-09-30T15:45:00Z', '2026-09-30T16:05:00Z']);
  const messages = await client.query(`SELECT created_at, delivery_status,
    (text ILIKE '%정비%' OR text ILIKE '%ready%' OR text ILIKE '%prepared%' OR text ILIKE '%체크인%') AS arrival_related
    FROM messages WHERE property_id = ANY($1::text[]) AND sender = 'host'
    AND created_at BETWEEN $2 AND $3 ORDER BY created_at LIMIT 20`, [ids, '2026-09-30T15:45:00Z', '2026-09-30T16:05:00Z']);
  console.log(JSON.stringify({ properties: properties.rows, cleanings: cleanings.rows, events: events.rows,
    bookings: bookings.rows, audits: audits.rows, messages: messages.rows }, null, 2));
  await client.query('ROLLBACK');
}
main().catch(error => { console.error(JSON.stringify({ code: error.code || error.name })); process.exitCode = 1; }).finally(() => client.end());
