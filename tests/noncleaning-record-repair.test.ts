import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const repair = await readFile(new URL('../scripts/db/correct-anon-noncleaning-20261001.sql', import.meta.url), 'utf8');
const restore = await readFile(new URL('../scripts/db/restore-anon-noncleaning-20261001.sql', import.meta.url), 'utf8');
const target = '0751098a-4fcf-4d82-8832-cf555efff17a';
const branch = '70X0HKDJasPU3RQj67aU';

async function fixture() {
  const sql = new PGlite();
  await sql.exec(`CREATE TABLE properties(id text PRIMARY KEY,name text,organization_id text);
    CREATE TABLE cleanings(id text PRIMARY KEY,property_id text,date text,status text,origin text,cleaner_id text,assistant_cleaner_id text,external_cleaner_name text,completed_at timestamptz,notes text,completion_note text);
    CREATE TABLE events(property_id text,type text,start_date text,end_date text,tags text[],title text);
    CREATE TABLE bookings(property_id text,status text,check_in text,check_out text);
    CREATE TABLE cleaning_visit_photos(cleaning_id text);
    CREATE TABLE cleaning_issues(cleaning_id text);
    CREATE TABLE cleaning_applications(cleaning_id text);
    CREATE TABLE audit_logs(id text PRIMARY KEY,actor_name text,action text,module text,target_type text,target_id text,property_id text,organization_id text,summary text,outcome text,details jsonb);`);
  await sql.query('INSERT INTO properties VALUES ($1,$2,$3)', [branch, '안온재', 'org']);
  await sql.query("INSERT INTO cleanings(id,property_id,date,status,origin) VALUES ($1,$2,'2026-10-01','done','manual'),('other',$2,'2026-10-04','done','auto')", [target, branch]);
  return sql;
}

test('confirmed non-cleaning record is reversibly cancelled with audit history; other dates remain intact', async () => {
  const sql = await fixture();
  try {
    await sql.exec(repair);
    assert.deepEqual((await sql.query<{ id: string; status: string }>('SELECT id,status FROM cleanings ORDER BY id')).rows,
      [{ id: target, status: 'cancelled' }, { id: 'other', status: 'done' }]);
    assert.equal((await sql.query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count, 1);
    await sql.exec(restore);
    assert.equal((await sql.query<{ status: string }>('SELECT status FROM cleanings WHERE id=$1', [target])).rows[0].status, 'done');
  } finally { await sql.close(); }
});

for (const evidence of ['checkout', 'assignee', 'photo']) test(`repair stops when ${evidence} evidence appears`, async () => {
  const sql = await fixture();
  try {
    if (evidence === 'checkout') await sql.query("INSERT INTO events VALUES ($1,'reservation','2026-09-29','2026-10-01','{}',NULL)", [branch]);
    if (evidence === 'assignee') await sql.query("UPDATE cleanings SET cleaner_id='staff' WHERE id=$1", [target]);
    if (evidence === 'photo') await sql.query('INSERT INTO cleaning_visit_photos VALUES ($1)', [target]);
    await assert.rejects(sql.exec(repair));
    await sql.exec('ROLLBACK');
    assert.equal((await sql.query<{ status: string }>('SELECT status FROM cleanings WHERE id=$1', [target])).rows[0].status, 'done');
    assert.equal((await sql.query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count, 0);
  } finally { await sql.close(); }
});
