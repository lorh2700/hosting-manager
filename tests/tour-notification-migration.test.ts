import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('tour notification migration is additive, isolated per business and mirrored in the API', async () => {
  const sql = new PGlite();
  try {
    await sql.exec("CREATE TABLE organizations(id text primary key); INSERT INTO organizations VALUES('a'),('b'); CREATE TABLE tour_bookings(id text primary key, phone text); INSERT INTO tour_bookings VALUES('booking', '01012345678');");
    const migration = await readFile(new URL('../prisma/migrations/20261101150000_tour_notification_settings/migration.sql', import.meta.url), 'utf8');
    const mirror = await readFile(new URL('../../hosting-manager-platform/apps/api/prisma/migrations/20261101150000_tour_notification_settings/migration.sql', import.meta.url), 'utf8');
    assert.equal(migration, mirror);
    await sql.exec(migration);
    assert.deepEqual((await sql.query('SELECT * FROM tour_bookings')).rows, [{ id: 'booking', phone: '01012345678' }]);
    await sql.exec("INSERT INTO tour_notification_settings VALUES('a','01033334444',now()),('b','01055556666',now());");
    await assert.rejects(sql.exec("INSERT INTO tour_notification_settings VALUES('a','01077778888',now());"));
    await assert.rejects(sql.exec("INSERT INTO tour_notification_settings VALUES('missing','01077778888',now());"));
    await sql.exec("DELETE FROM organizations WHERE id='a';");
    assert.deepEqual((await sql.query('SELECT organization_id,phone FROM tour_notification_settings')).rows, [{ organization_id: 'b', phone: '01055556666' }]);
    assert.deepEqual((await sql.query("SELECT relrowsecurity FROM pg_class WHERE relname='tour_notification_settings'")).rows, [{ relrowsecurity: true }]);
  } finally { await sql.close(); }
});
