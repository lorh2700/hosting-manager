import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('pause source migration preserves unknown legacy pauses and accepts only explicit sources', async () => {
  const sql = new PGlite();
  try {
    await sql.exec("CREATE TABLE inquiry_conversations(event_id text primary key, paused boolean, reason text); INSERT INTO inquiry_conversations VALUES('legacy',true,'existing reason');");
    const migration = await readFile(new URL('../prisma/migrations/20261101160000_inquiry_pause_source/migration.sql', import.meta.url), 'utf8');
    const mirror = await readFile(new URL('../../hosting-manager-platform/apps/api/prisma/migrations/20261101160000_inquiry_pause_source/migration.sql', import.meta.url), 'utf8');
    assert.equal(migration, mirror);
    await sql.exec(migration);
    assert.deepEqual((await sql.query('SELECT * FROM inquiry_conversations')).rows,
      [{ event_id: 'legacy', paused: true, reason: 'existing reason', pause_source: null, pause_message_id: null }]);
    await sql.exec("INSERT INTO inquiry_conversations VALUES('manual',true,'operator','manual',null),('automatic',true,'inquiry','automatic','message-1');");
    await assert.rejects(sql.exec("UPDATE inquiry_conversations SET pause_source='unknown' WHERE event_id='legacy';"));
  } finally { await sql.close(); }
});
