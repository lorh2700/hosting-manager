import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../prisma/migrations/20260917020000_users_staff_identity/migration.sql', import.meta.url), 'utf8');
const diagnostic = await readFile(new URL('../scripts/check-staff-identity-state.sql', import.meta.url), 'utf8');
const doyoungMerge = (await readFile(new URL('../scripts/merge-doyoung-users.sql', import.meta.url), 'utf8'))
  .replace("source_id TEXT := 'staff-vFeH4skk3leswVgev6kZ'", "source_id TEXT := 'staff-cn'")
  .replace("target_id TEXT := '6f53c2b2-2653-42ec-bf1a-0d2cc5b71077'", "target_id TEXT := 'owner'");
const pairMerge = (await readFile(new URL('../scripts/merge-jeongwon-sohyeon-users.sql', import.meta.url), 'utf8'))
  .replaceAll('2aa9fb37-59f6-4a4b-ad6b-390f75420821', 'owner')
  .replaceAll('a9b28d8d-c06e-40d9-a1a5-d46a040da3b5', 'manager')
  .replaceAll('9168659e-3948-4a76-9e05-b252378ae62d', 'worker');
const merge = (await readFile(new URL('../scripts/merge-mindeulle-users.sql', import.meta.url), 'utf8'))
  .replace("source_id TEXT := 'staff-TWILlfEkjFh1FIJI60wK'", "source_id TEXT := 'staff-cn'")
  .replace("target_id TEXT := '35f34482-ff4e-4d15-a5c0-721c35a463cc'", "target_id TEXT := 'owner'");
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
    // The extended query protocol accepts one statement only, as in an autocommit editor.
    const before = (await db.query<Record<string, unknown>>(diagnostic)).rows[0];
    assert.equal(before.old_cleaners_exists, true);
    assert.deepEqual(before.added_user_columns, []);
    assert.equal(before.cleaning_assignee_table, 'cleaners');
    await db.query(migration);
    const after = (await db.query<Record<string, unknown>>(diagnostic)).rows[0];
    assert.equal(after.old_cleaners_exists, false);
    assert.equal(after.legacy_cleaners_exists, true);
    assert.equal(after.cleaning_assignee_table, 'users');
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

test('실제 PostgreSQL: 이전 실행의 일부 컬럼이 남아 있으면 변경 전에 중단한다', async () => {
  const db = await fixture();
  try {
    await db.exec('ALTER TABLE users ADD COLUMN owner_id TEXT');
    await assert.rejects(db.query(migration), /already or partially applied/);
    assert.equal((await db.query<Record<string, unknown>>("SELECT cleaner_id FROM cleanings WHERE id='job-m'")).rows[0].cleaner_id, 'cm');
    assert.equal((await db.query<Record<string, unknown>>(diagnostic)).rows[0].identity_map_exists, false);
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
    // A failed single statement must roll back without a separate ROLLBACK command.
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

async function mergeFixture() {
  const db = await fixture();
  await db.exec("ALTER TABLE invitations ADD COLUMN status TEXT DEFAULT 'pending'; UPDATE cleaners SET name='민들레' WHERE id='cn'; UPDATE users SET display_name='민들레',email='min@test.com' WHERE id='owner'");
  await db.query(migration);
  await db.exec("INSERT INTO cleaning_applications VALUES ('raw','staff-cn','staff-cn'); INSERT INTO user_properties VALUES ('owner','p1')");
  return db;
}

async function doyoungFixture() {
  const db = await mergeFixture();
  await db.exec(`UPDATE users SET display_name='도영',phone='01094222421' WHERE id='staff-cn';
    UPDATE users SET display_name='lorh2700@gmail.com',email='lorh2700@gmail.com' WHERE id='owner';
    INSERT INTO cleanings SELECT 'doyoung-'||n,'staff-cn','p1' FROM generate_series(1,10) n;`);
  return db;
}

test('도영: 관리자 로그인 유지, 이름·전화번호·11건·청소 링크와 참조 통합', async () => {
  const db = await doyoungFixture();
  try {
    await db.query(doyoungMerge);
    assert.deepEqual((await db.query("SELECT display_name,email,password,phone,role,public_token FROM users WHERE id='owner'")).rows[0],
      { display_name: '도영', email: 'lorh2700@gmail.com', password: 'owner-password', phone: '01094222421', role: 'admin', public_token: 'link-only' });
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM cleanings WHERE cleaner_id='owner'")).rows[0].n, 11);
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM users WHERE id='staff-cn'")).rows[0].n, 0);
    assert.equal((await db.query<Record<string, unknown>>("SELECT user_id FROM staff_identity_map WHERE cleaner_id='cn'")).rows[0].user_id, 'owner');
    assert.equal((await db.query<Record<string, unknown>>("SELECT applicant_id FROM cleaning_applications WHERE id='raw'")).rows[0].applicant_id, 'owner');
    await assert.rejects(db.query(doyoungMerge));
  } finally { await db.close(); }
});

test('도영: 미처리 참조가 있으면 이름·토큰·일정 변경까지 전부 롤백', async () => {
  const db = await doyoungFixture();
  try {
    await db.exec("CREATE TABLE additional_reference(user_id TEXT REFERENCES users(id) ON DELETE CASCADE); INSERT INTO additional_reference VALUES ('staff-cn')");
    await assert.rejects(db.query(doyoungMerge), /Unmoved reference/);
    assert.equal((await db.query<Record<string, unknown>>("SELECT display_name FROM users WHERE id='owner'")).rows[0].display_name, 'lorh2700@gmail.com');
    assert.equal((await db.query<Record<string, unknown>>("SELECT public_token FROM users WHERE id='staff-cn'")).rows[0].public_token, 'link-only');
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM cleanings WHERE cleaner_id='staff-cn'")).rows[0].n, 11);
  } finally { await db.close(); }
});

async function pairFixture() {
  const db = await fixture();
  await db.exec(`
    ALTER TABLE invitations ADD COLUMN status TEXT DEFAULT 'pending';
    DELETE FROM cleanings;
    DELETE FROM cleaner_properties WHERE cleaner_id='cm';
    DELETE FROM cleaners WHERE id='cm';
    UPDATE users SET display_name='정원',email='yun@test.com' WHERE id='owner';
    UPDATE users SET display_name=NULL,email='byha2613@gmail.com',role='admin' WHERE id='manager';
    UPDATE users SET display_name='소현' WHERE id='worker';
    UPDATE cleaners SET name='윤나',phone='01040887715' WHERE id='cn';
    UPDATE cleaners SET name='소현' WHERE id='cw';
    INSERT INTO cleanings SELECT 'yn-'||n,'cn','p1' FROM generate_series(1,79) n;
    INSERT INTO cleanings SELECT 'sh-'||n,'cw','p2' FROM generate_series(1,13) n;
  `);
  await db.query(migration);
  return db;
}

test('정원·소현: 두 계정 병합 후 이름·관리자 이메일/비밀번호·79/13건과 기존 청소 링크를 보존한다', async () => {
  const db = await pairFixture();
  try {
    await db.query(pairMerge);
    assert.deepEqual((await db.query("SELECT display_name,email,password,public_token FROM users ORDER BY id")).rows, [
      { display_name: '소현', email: 'byha2613@gmail.com', password: 'manager-password', public_token: 'worker-link' },
      { display_name: '정원', email: 'yun@test.com', password: 'owner-password', public_token: 'link-only' },
    ]);
    assert.deepEqual((await db.query('SELECT cleaner_id,count(*)::int AS n FROM cleanings GROUP BY cleaner_id ORDER BY cleaner_id')).rows,
      [{ cleaner_id: 'manager', n: 13 }, { cleaner_id: 'owner', n: 79 }]);
    assert.equal((await db.query<Record<string, unknown>>('SELECT count(*)::int AS n FROM staff_user_merge_archive')).rows[0].n, 2);
    assert.equal((await db.query<Record<string, unknown>>("SELECT phone FROM users WHERE id='owner'")).rows[0].phone, '01040887715');
    assert.equal((await db.query<Record<string, unknown>>("SELECT phone FROM users WHERE id='manager'")).rows[0].phone, '01033334444');
  } finally { await db.close(); }
});

test('정원·소현: 두 번째 병합 충돌 시 먼저 수행한 정원 병합도 롤백한다', async () => {
  const db = await pairFixture();
  try {
    await db.exec("UPDATE users SET phone='01099990000' WHERE id='manager'");
    await assert.rejects(db.query(pairMerge), /Phone conflict/);
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM cleanings WHERE cleaner_id='staff-cn'")).rows[0].n, 79);
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM users")).rows[0].n, 4);
    assert.equal((await db.query<Record<string, unknown>>("SELECT to_regclass('staff_user_merge_archive') AS archive")).rows[0].archive, null);
  } finally { await db.close(); }
});

test('동일인 정리: 관리자 로그인·숙소·연락처·청소 링크·이력과 대응표를 보존하고 중복 행만 제거한다', async () => {
  const db = await mergeFixture();
  try {
    await db.query(merge);
    const account = (await db.query<Record<string, unknown>>("SELECT email,password,role,status,phone,public_token FROM users WHERE id='owner'")).rows[0];
    assert.deepEqual(account, { email: 'min@test.com', password: 'owner-password', role: 'admin', status: 'active', phone: '01055556666', public_token: 'link-only' });
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM users WHERE id='staff-cn'")).rows[0].n, 0);
    assert.equal((await db.query<Record<string, unknown>>("SELECT cleaner_id FROM cleanings WHERE id='job-n'")).rows[0].cleaner_id, 'owner');
    assert.equal((await db.query<Record<string, unknown>>("SELECT user_id FROM staff_identity_map WHERE cleaner_id='cn'")).rows[0].user_id, 'owner');
    assert.deepEqual((await db.query<Record<string, unknown>>("SELECT cleaner_id,status FROM invitations WHERE id='invite'")).rows[0], { cleaner_id: 'owner', status: 'expired' });
    assert.deepEqual((await db.query<Record<string, unknown>>("SELECT applicant_id,processed_by FROM cleaning_applications WHERE id='raw'")).rows[0], { applicant_id: 'owner', processed_by: 'owner' });
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM user_properties WHERE user_id='owner'")).rows[0].n, 2);
    assert.equal((await db.query<Record<string, unknown>>("SELECT source_before->>'public_token' AS token FROM staff_user_merge_archive")).rows[0].token, 'link-only');
    await assert.rejects(db.query(merge));
    assert.equal((await db.query<Record<string, unknown>>("SELECT count(*)::int AS n FROM cleanings")).rows[0].n, 3);
  } finally { await db.close(); }
});

for (const [label, setup, error] of [
  ['전화번호 충돌', "UPDATE users SET phone='01099990000' WHERE id='owner'", /Phone conflict/],
  ['관리 소유권', "INSERT INTO users(id,email,password,role,status,owner_id) VALUES ('other','other@test','','cleaner','no_account','staff-cn')", /management ownership/],
  ['알 수 없는 cascade 참조', "CREATE TABLE extra_reference(user_id TEXT REFERENCES users(id) ON DELETE CASCADE); INSERT INTO extra_reference VALUES ('staff-cn')", /Unmoved reference/],
] as const) test(`동일인 정리: ${label}이면 전체 롤백한다`, async () => {
  const db = await mergeFixture();
  try {
    await db.exec(setup);
    await assert.rejects(db.query(merge), error);
    assert.equal((await db.query<Record<string, unknown>>("SELECT public_token FROM users WHERE id='staff-cn'")).rows[0].public_token, 'link-only');
    assert.equal((await db.query<Record<string, unknown>>("SELECT cleaner_id FROM cleanings WHERE id='job-n'")).rows[0].cleaner_id, 'staff-cn');
    assert.equal((await db.query<Record<string, unknown>>("SELECT to_regclass('staff_user_merge_archive') AS archive")).rows[0].archive, null);
  } finally { await db.close(); }
});
