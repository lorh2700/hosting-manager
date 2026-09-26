// Explicit one-time suppression of old inquiries. Preview by default; --apply saves it.
import fs from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

const local = fs.existsSync('.env.local') ? dotenv.parse(fs.readFileSync('.env.local')) : {};
const env = { ...local, ...process.env };
const client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT || 6543),
  database: env.DB_NAME || 'postgres', user: env.DB_USER, password: env.DB_PASSWORD,
  connectionTimeoutMillis: 7000, statement_timeout: 10000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE inquiry_automation_settings, inquiry_jobs, inquiry_notifications IN SHARE ROW EXCLUSIVE MODE');
  const { rows: [{ cutoff }] } = await client.query('SELECT clock_timestamp() AS cutoff');
  const inFlight = await client.query("SELECT count(*)::int AS count FROM inquiry_jobs WHERE status='sending'");
  const notificationsInFlight = await client.query("SELECT count(*)::int AS count FROM inquiry_notifications WHERE status='sending'");
  if (inFlight.rows[0].count || notificationsInFlight.rows[0].count) throw new Error('IN_FLIGHT_SEND_REQUIRES_REVIEW');
  const settings = await client.query(`UPDATE inquiry_automation_settings SET enabled_at=GREATEST(enabled_at,$1), updated_at=$1 WHERE enabled=true`, [cutoff]);
  const jobs = await client.query(`UPDATE inquiry_jobs j SET status='skipped', reason='이전 문의 자동처리 제외', lease_token=NULL, lease_until=NULL
    FROM messages m WHERE m.id=j.message_id AND m.created_at<=$1 AND j.status IN ('queued','verify','booking','ready','checked')`, [cutoff]);
  const notifications = await client.query(`UPDATE inquiry_notifications n SET status='cancelled'
    FROM inquiry_jobs j JOIN messages m ON m.id=j.message_id
    WHERE n.job_id=j.message_id AND m.created_at<=$1 AND n.status IN ('pending','failed')`, [cutoff]);
  const apply = process.argv.includes('--apply');
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ applied: apply, cutoff, settings: settings.rowCount, skippedJobs: jobs.rowCount, cancelledNotifications: notifications.rowCount }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(error.code || (error.message === 'IN_FLIGHT_SEND_REQUIRES_REVIEW' ? error.message : 'CUTOFF_RESET_FAILED'));
  process.exitCode = 1;
} finally {
  await client.end();
}
