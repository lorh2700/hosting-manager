import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('interim migration preserves request scope and rejects duplicate dates, invalid details and broken schedule links', async () => {
  const sql = new PGlite();
  try {
    await sql.exec('CREATE TABLE cleanings(id TEXT PRIMARY KEY); CREATE TABLE audit_logs(id TEXT PRIMARY KEY);');
    for (const migration of ['20261002140000_guest_stays', '20261020160000_cleaning_assignment_notifications', '20261101030000_guest_interim_cleaning_requests']) {
      await sql.exec(await readFile(new URL('../prisma/migrations/' + migration + '/migration.sql', import.meta.url), 'utf8'));
    }
    const details = { date: '2026-11-03', time: '13:00', note: '' };
    const insert = (id: string, payload = details, reservationId = 'stay') => sql.query(`INSERT INTO guest_stay_requests(id,property_id,reservation_kind,reservation_id,guest_name,kind,details,payload_hash)
      VALUES ($1,'property','booking',$2,'Guest','interim_cleaning',$3,'hash')`, [id, reservationId, payload]);
    await insert('one');
    await assert.rejects(insert('duplicate'), /guest_stay_requests_interim_active_date_key/);
    await insert('other-stay', details, 'other');
    await assert.rejects(insert('bad-time', { ...details, date: '2026-11-04', time: '25:00' }), /guest_stay_requests_interim_details_check/);
    await assert.rejects(insert('bad-note', { ...details, date: '2026-11-04', note: 'a'.repeat(1001) }), /guest_stay_requests_interim_details_check/);
    await sql.exec("UPDATE guest_stay_requests SET status='cancelled' WHERE id='one'");
    await insert('resubmitted');
    await assert.rejects(sql.exec("UPDATE guest_stay_requests SET cleaning_id='missing' WHERE id='resubmitted'"), /foreign key/);
    await sql.exec("INSERT INTO cleanings VALUES ('cleaning'); UPDATE guest_stay_requests SET cleaning_id='cleaning' WHERE id='resubmitted'");
    await assert.rejects(sql.exec("UPDATE guest_stay_requests SET cleaning_id='cleaning' WHERE id='other-stay'"), /guest_stay_requests_cleaning_id_key/);
    await assert.rejects(sql.exec("DELETE FROM cleanings WHERE id='cleaning'"), /foreign key/);
    await sql.exec("INSERT INTO audit_logs VALUES ('audit'); INSERT INTO cleaning_assignment_notifications(id,audit_id,role,kind,recipient_id) VALUES ('delivery','audit','primary','recruitment','staff')");
    const result = await sql.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='guest_stay_requests'");
    assert.equal(result.rows[0].relrowsecurity, true);
    const canonical = await readFile(new URL('../prisma/migrations/20261101030000_guest_interim_cleaning_requests/migration.sql', import.meta.url), 'utf8');
    const mirror = await readFile(new URL('../../hosting-manager-platform/apps/api/prisma/migrations/20261101030000_guest_interim_cleaning_requests/migration.sql', import.meta.url), 'utf8');
    assert.equal(canonical, mirror);
  } finally { await sql.close(); }
});
