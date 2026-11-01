import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('tour selections migration preserves existing checkout orders and checks snapshot shape', async () => {
  const sql = new PGlite();
  try {
    await sql.exec("CREATE TABLE checkout_orders(id text primary key, terms text not null); INSERT INTO checkout_orders VALUES('existing','accepted terms');");
    await sql.exec("CREATE TABLE tour_bookings(id text primary key, tour_id text not null); INSERT INTO tour_bookings VALUES('existing','tour-1');");
    await sql.exec("CREATE TABLE organizations(id text primary key); INSERT INTO organizations VALUES('org-1'); CREATE TABLE tours(id text primary key); INSERT INTO tours VALUES('existing');");
    const migration = await readFile(new URL('../prisma/migrations/20261101070000_checkout_tour_selections/migration.sql', import.meta.url), 'utf8');
    const mirror = await readFile(new URL('../../hosting-manager-platform/apps/api/prisma/migrations/20261101070000_checkout_tour_selections/migration.sql', import.meta.url), 'utf8');
    assert.equal(migration, mirror);
    await sql.exec(migration);
    assert.deepEqual((await sql.query('SELECT * FROM checkout_orders')).rows, [{ id: 'existing', terms: 'accepted terms', tour_selections: null }]);
    await sql.query('UPDATE checkout_orders SET tour_selections=$1', [JSON.stringify({ version: 1, selections: [] })]);
    for (const value of [{}, [], { version: 2, selections: [] }, { version: 1, selections: [{}, {}, {}, {}] }]) {
      await assert.rejects(sql.query('UPDATE checkout_orders SET tour_selections=$1', [JSON.stringify(value)]));
    }
    assert.deepEqual((await sql.query('SELECT * FROM tour_bookings')).rows, [{ id: 'existing', tour_id: 'tour-1', request_key: null, request_hash: null }]);
    const key = 'ad7582ce-7272-4018-b2fc-ebcd85446bd8';
    const hash = 'a'.repeat(64);
    await sql.query('INSERT INTO tour_bookings VALUES($1,$2,$3,$4)', ['new', 'tour-1', key, hash]);
    await assert.rejects(sql.query('INSERT INTO tour_bookings VALUES($1,$2,$3,$4)', ['duplicate', 'tour-1', key, hash]));
    await sql.query('INSERT INTO tour_bookings VALUES($1,$2,$3,$4)', ['second-tour', 'tour-2', key, hash]);
    await assert.rejects(sql.query('INSERT INTO tour_bookings VALUES($1,$2,$3,$4)', ['bad', 'tour-3', key, null]));
    assert.deepEqual((await sql.query('SELECT * FROM tours')).rows, [{ id: 'existing', organization_id: null }]);
    await assert.rejects(sql.query('UPDATE tours SET organization_id=$1', ['missing']));
    await sql.query('UPDATE tours SET organization_id=$1', ['org-1']);
    await assert.rejects(sql.query('DELETE FROM organizations WHERE id=$1', ['org-1']));
  } finally { await sql.close(); }
});
