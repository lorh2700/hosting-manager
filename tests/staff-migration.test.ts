import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../prisma/migrations/20260917020000_users_staff_identity/migration.sql', import.meta.url), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,display_name TEXT,phone TEXT,role TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMP DEFAULT now(),updated_at TIMESTAMP DEFAULT now());
    CREATE TABLE properties(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id));
    CREATE TABLE user_properties(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,property_id TEXT REFERENCES properties(id),PRIMARY KEY(user_id,property_id));
    CREATE TABLE cleaners(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE,public_token TEXT UNIQUE,user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,owner_id TEXT NOT NULL REFERENCES users(id),notify_new_open BOOLEAN NOT NULL DEFAULT true,no_properties BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMP DEFAULT now());
    CREATE TABLE cleaner_properties(cleaner_id TEXT REFERENCES cleaners(id),property_id TEXT REFERENCES properties(id),PRIMARY KEY(cleaner_id,property_id));
    CREATE TABLE cleanings(id TEXT PRIMARY KEY,cleaner_id TEXT REFERENCES cleaners(id),property_id TEXT REFERENCES properties(id));
    CREATE TABLE invitations(id TEXT PRIMARY KEY,cleaner_id TEXT REFERENCES cleaners(id),invited_by TEXT REFERENCES users(id));
    CREATE TABLE tour_operators(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id));
    CREATE TABLE tours(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id));
    CREATE TABLE cleaning_applications(id TEXT PRIMARY KEY,applicant_id TEXT,processed_by TEXT);
    CREATE TABLE cleaning_issues(id TEXT PRIMARY KEY,reported_by TEXT,resolved_by TEXT);
    INSERT INTO users(id,email,password,display_name,phone,role,status) VALUES
      ('owner','owner@test','owner-password','운영자',null,'admin','active'),
      ('manager','manager@test','manager-password','민들레',null,'manager','active'),
      ('worker','worker@test','worker-password','청소',null,'cleaner','active');
    INSERT INTO properties VALUES ('p1','owner'),('p2','owner');
    INSERT INTO user_properties VALUES ('manager','p1');
    INSERT INTO cleaners(id,name,phone,public_token,user_id,owner_id) VALUES
      ('cm','민들레','01011112222','manager-link','manager','owner'),
      ('cw','청소','01033334444','worker-link','worker','owner'),
      ('cn','링크 직원','01055556666','link-only',null,'owner');
    INSERT INTO cleaner_properties VALUES ('cm','p1');
    INSERT INTO cleanings VALUES ('job-m','cm','p1'),('job-w','cw','p2'),('job-n','cn','p1');
    INSERT INTO invitations VALUES ('invite','cn','owner');
  `);
  return db;
}

test('실제 PostgreSQL: 전화번호·계정·숙소·일정 링크와 외래키를 users로 이관한다', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    assert.deepEqual((await db.query<Record<string, unknown>>('SELECT cleaner_id FROM cleanings ORDER BY id')).rows, [{ cleaner_id: 'manager' }, { cleaner_id: 'staff-cn' }, { cleaner_id: 'worker' }]);
    assert.deepEqual((await db.query<Record<string, unknown>>("SELECT phone,password,role,public_token FROM users WHERE id='manager'")).rows[0], { phone: '01011112222', password: 'manager-password', role: 'manager', public_token: 'manager-link' });
    assert.deepEqual((await db.query<Record<string, unknown>>("SELECT status,password,public_token FROM users WHERE id='staff-cn'")).rows[0], { status: 'no_account', password: '', public_token: 'link-only' });
    assert.deepEqual((await db.query<Record<string, unknown>>("SELECT property_id FROM user_properties WHERE user_id='worker' ORDER BY property_id")).rows, [{ property_id: 'p1' }, { property_id: 'p2' }]);
    assert.equal((await db.query<Record<string, unknown>>("SELECT cleaner_id FROM invitations WHERE id='invite'")).rows[0].cleaner_id, 'staff-cn');
    assert.equal((await db.query<Record<string, unknown>>('SELECT count(*)::int AS count FROM legacy_cleaners')).rows[0].count, 3);
    await assert.rejects(db.exec("INSERT INTO cleanings VALUES ('bad','cw','p1')"));
    await db.exec("INSERT INTO cleanings VALUES ('direct-manager','manager','p1')");
  } finally { await db.close(); }
});

test('실제 PostgreSQL: 검토한 중복 계정 매핑은 신청·신고 참조를 이전하고 중복 로그인을 제거한다', async () => {
  const db = await fixture();
  try {
    await db.exec(`DELETE FROM cleanings WHERE id='job-m'; DELETE FROM cleaner_properties WHERE cleaner_id='cm'; DELETE FROM cleaners WHERE id='cm';
      UPDATE users SET phone='01033334444' WHERE id='manager';
      INSERT INTO cleaner_properties VALUES ('cw','p1');
      INSERT INTO cleaning_applications VALUES ('app','worker','worker');
      INSERT INTO cleaning_issues VALUES ('issue','worker','worker');
      CREATE TABLE staff_identity_map(cleaner_id TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,source_user_id TEXT,migrated_at TIMESTAMP);
      INSERT INTO staff_identity_map(cleaner_id,user_id) VALUES ('cw','manager');`);
    await db.exec(migration);
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS count FROM users WHERE id='worker'")).rows[0].count, 0);
    assert.equal((await db.query<Record<string, unknown>>("SELECT applicant_id FROM cleaning_applications WHERE id='app'")).rows[0].applicant_id, 'manager');
    assert.equal((await db.query<Record<string, unknown>>("SELECT reported_by FROM cleaning_issues WHERE id='issue'")).rows[0].reported_by, 'manager');
    assert.equal((await db.query<Record<string, unknown>>("SELECT password FROM users WHERE id='manager'")).rows[0].password, 'manager-password');
  } finally { await db.close(); }
});

for (const [label, setup, expected] of [
  ['전화번호 충돌', "UPDATE users SET phone='01099998888' WHERE id='manager'", /Phone conflict/],
  ['관리 권한 확대', "INSERT INTO cleaner_properties VALUES ('cm','p2')", /exceeds management scope/],
] as const) test(`실제 PostgreSQL: ${label}이면 전체 이관을 롤백한다`, async () => {
  const db = await fixture();
  try {
    await db.exec(setup);
    await assert.rejects(db.exec(migration), expected);
    await db.exec('ROLLBACK');
    assert.equal((await db.query<Record<string, unknown>>("SELECT cleaner_id FROM cleanings WHERE id='job-m'")).rows[0].cleaner_id, 'cm');
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='users' AND column_name='public_token'")).rows[0].count, 0);
    assert.equal((await db.query<Record<string, unknown>>('SELECT count(*)::int AS count FROM cleaners')).rows[0].count, 3);
  } finally { await db.close(); }
});

test('실제 PostgreSQL: 명시적 배정 없음은 소유 운영자 전체로 확대되지 않는다', async () => {
  const db = await fixture();
  try {
    await db.exec("UPDATE cleaners SET no_properties=true WHERE id='cw'");
    await db.exec(migration);
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS count FROM user_properties WHERE user_id='worker'")).rows[0].count, 0);
  } finally { await db.close(); }
});
