import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('assistant migration preserves historical duplicates and blocks new active checkout collisions', async () => {
  const sql = new PGlite();
  try {
    await sql.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE properties(id TEXT PRIMARY KEY);
      CREATE TABLE cleanings(id TEXT PRIMARY KEY,property_id TEXT,date TEXT,origin TEXT,status TEXT,cleaner_id TEXT);
      CREATE TABLE cleaning_applications(id TEXT PRIMARY KEY,cleaning_id TEXT,status TEXT);
      INSERT INTO users VALUES('primary'),('assistant'); INSERT INTO properties VALUES('p');
      INSERT INTO cleanings VALUES('legacy-a','p','2026-10-02','auto','pending','primary'),('legacy-b','p','2026-10-02','manual','pending','primary');`);
    const migration = await readFile(new URL('../prisma/migrations/20261020150000_cleaning_assistant_slots/migration.sql', import.meta.url), 'utf8');
    await sql.exec(migration); await sql.exec(migration);
    assert.equal((await sql.query('SELECT id FROM cleanings')).rows.length, 2);
    await assert.rejects(sql.exec(`INSERT INTO cleanings(id,property_id,date,origin,status) VALUES('third','p','2026-10-02','external','pending')`), /cleaning_slot_conflict/);
    await sql.exec(`INSERT INTO cleanings(id,property_id,date,origin,status,cleaner_id,assistant_cleaner_id) VALUES('new','p','2026-10-03','auto','pending','primary','assistant');`);
    await assert.rejects(sql.exec(`UPDATE cleanings SET date='2026-10-02' WHERE id='new'`), /cleaning_slot_conflict/);
    await assert.rejects(sql.exec(`UPDATE cleanings SET assistant_cleaner_id='primary' WHERE id='new'`), /cleanings_distinct_assignees/);
    await sql.exec(`INSERT INTO cleanings(id,property_id,date,origin,status) VALUES('interim','p','2026-10-03','interim','pending'),('cancelled','p','2026-10-03','auto','cancelled');`);
    await assert.rejects(sql.exec(`UPDATE cleanings SET status='pending' WHERE id='cancelled'`), /cleaning_slot_conflict/);
    await sql.exec(`UPDATE cleanings SET cleaner_id=NULL WHERE id='legacy-b'; INSERT INTO cleaning_applications VALUES('a','new','approved','assistant');`);
    assert.equal((await sql.query<{ role: string }>("SELECT role FROM cleaning_applications WHERE id='a'")).rows[0].role, 'assistant');
    assert.equal((await sql.query("SELECT id FROM cleanings WHERE date='2026-10-02'")).rows.length, 2);
  } finally { await sql.close(); }
});

test('assignment notification migration is additive, repeatable and deduplicates each role recipient', async () => {
  const sql = new PGlite();
  try {
    await sql.exec("CREATE TABLE audit_logs(id TEXT PRIMARY KEY); INSERT INTO audit_logs VALUES('audit');");
    const migration = await readFile(new URL('../prisma/migrations/20261020160000_cleaning_assignment_notifications/migration.sql', import.meta.url), 'utf8');
    await sql.exec(migration); await sql.exec(migration);
    await sql.exec("INSERT INTO cleaning_assignment_notifications(id,audit_id,role,kind,recipient_id) VALUES('a','audit','primary','assigned','u');");
    await assert.rejects(sql.exec("INSERT INTO cleaning_assignment_notifications(id,audit_id,role,kind,recipient_id) VALUES('b','audit','primary','assigned','u');"), /cleaning_assignment_notifications_recipient_key/);
    await sql.exec("INSERT INTO cleaning_assignment_notifications(id,audit_id,role,kind,recipient_id) VALUES('b','audit','assistant','assigned','v');");
    await assert.rejects(sql.exec("UPDATE cleaning_assignment_notifications SET state='invalid' WHERE id='a';"), /state_check/);
    await assert.rejects(sql.exec("DELETE FROM audit_logs WHERE id='audit';"), /foreign key/);
    assert.equal((await sql.query('SELECT id FROM cleaning_assignment_notifications')).rows.length, 2);
  } finally { await sql.close(); }
});
