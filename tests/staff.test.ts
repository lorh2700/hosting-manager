import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous, authState } from './stubs/auth';
import { makeRequest, callRoute } from './helpers/beds24-mock';
import { GET, POST } from '../app/api/staff/route';
import { PUT as CLEANER_PUT } from '../app/api/cleaners/route';
import { PUT as USER_PUT } from '../app/api/users/route';
import { PUT as SCOPE } from '../app/api/cleaners/[id]/properties/route';
import { POST as RESET } from '../app/api/cleaners/[id]/reset-password/route';
import { cleanerPropertyIds } from '../lib/access';

const input = { name: '청소 직원', phone: '010-1234-5678', mode: 'selected', propertyIds: ['p1'], loginEnabled: true, notifyNewOpen: true };
const scoped = (handler: typeof SCOPE, body: unknown, id = 'c1') => callRoute(req => handler(req, { params: Promise.resolve({ id }) }), makeRequest(body));
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.property = [{ id: 'p1', name: '숙소 A', ownerId: 'host-1' }, { id: 'p2', name: '숙소 B', ownerId: 'other' }];
  db.user = [{ id: 'admin-1', displayName: '관리자', phone: '01011112222', email: 'admin@test.com', password: 'secret', role: 'admin', status: 'active' }];
});

test('통합 목록은 연결된 청소 계정을 한 번만 표시하고 계정 없는 담당자를 포함한다', async () => {
  db.user.push({ id: 'u1', displayName: '계정 이름', phone: '01033334444', email: '01033334444@cleaner.va', role: 'cleaner', status: 'active', password: 'hidden' });
  db.cleaner = [{ id: 'c1', name: '청소 직원', phone: '01033334444', userId: 'u1', ownerId: 'host-1', noProperties: false }, { id: 'c2', name: '링크 직원', userId: null, ownerId: 'other', noProperties: true }];
  const result = await callRoute(GET, makeRequest({}));
  assert.equal(result.status, 200); assert.equal(result.body.staff.length, 3);
  assert.equal(result.body.staff.filter((row: any) => row.userId === 'u1').length, 1);
  const link = result.body.staff.find((row: any) => row.cleanerId === 'c2');
  assert.equal(link.status, 'no_account'); assert.equal(link.scope, 'none');
  assert.equal(JSON.stringify(result.body).includes('hidden'), false); assert.equal(JSON.stringify(result.body).includes('secret'), false);
});

test('매니저는 본인이 등록한 청소 직원만 조회하고 청소·익명 계정은 거부한다', async () => {
  db.cleaner = [{ id: 'c1', name: '내 직원', userId: null, ownerId: 'host-1' }, { id: 'c2', name: '다른 직원', userId: null, ownerId: 'other' }];
  actAsManager(['p1']);
  const result = await callRoute(GET, makeRequest({}));
  assert.deepEqual(result.body.staff.map((row: any) => row.cleanerId), ['c1']);
  assert.deepEqual(result.body.properties.map((row: any) => row.id), ['p1']);
  actAsCleaner(['p1']); assert.equal((await callRoute(GET, makeRequest({}))).status, 403); assert.equal((await callRoute(POST, makeRequest(input))).status, 403);
  actAsAnonymous(); assert.equal((await callRoute(GET, makeRequest({}))).status, 401);
});

test('청소 직원 등록은 프로필·로그인·배정을 함께 만들고 초기 비밀번호를 암호화한다', async () => {
  const result = await callRoute(POST, makeRequest(input));
  assert.equal(result.status, 201);
  const c = db.cleaner[0]; const user = db.user.find(row => row.id === c.userId)!;
  assert.equal(user.role, 'cleaner'); assert.equal(user.email, '01012345678@cleaner.va');
  assert.equal(await bcrypt.compare(result.body.initialPassword, user.password), true);
  assert.notEqual(result.body.initialPassword, '5678');
  assert.deepEqual(db.cleanerProperty.map(row => row.propertyId), ['p1']);
  assert.equal(c.noProperties, false); assert.ok(c.publicToken);
});

test('로그인 없는 직원 및 명시적 배정 없음을 저장하고 기존 전체 배정은 유지한다', async () => {
  const result = await callRoute(POST, makeRequest({ ...input, loginEnabled: false, mode: 'none', propertyIds: [] }));
  assert.equal(result.status, 201); assert.equal(result.body.initialPassword, null); assert.equal(db.user.length, 1);
  assert.equal(db.cleaner[0].userId, null); assert.deepEqual(await cleanerPropertyIds(db.cleaner[0] as any), []);
  db.cleaner.push({ id: 'legacy', name: '기존', ownerId: 'host-1' });
  assert.deepEqual(await cleanerPropertyIds({ id: 'legacy', ownerId: 'host-1' }), ['p1']);
});

test('회원 등록은 범위 밖 숙소·중복 연락처·잘못된 입력을 거부한다', async () => {
  actAsManager(['p1']);
  assert.equal((await callRoute(POST, makeRequest({ ...input, propertyIds: ['p2'] }))).status, 403);
  for (const body of [{ ...input, phone: 'bad' }, { ...input, propertyIds: [] }, { ...input, role: 'admin' }]) assert.equal((await callRoute(POST, makeRequest(body))).status, 400);
  db.user.push({ id: 'existing', phone: '01012345678', email: 'existing@test.com' });
  assert.equal((await callRoute(POST, makeRequest(input))).status, 409);
  assert.equal((db.cleaner || []).length, 0);
});

test('배정 없음·선택·전체 전환은 청소 이력과 일정 링크를 보존한다', async () => {
  db.cleaner = [{ id: 'c1', name: '청소', ownerId: 'host-1', publicToken: 'keep', noProperties: false }];
  db.cleaning = [{ id: 'history', cleanerId: 'c1', propertyId: 'p1' }];
  assert.equal((await scoped(SCOPE, { mode: 'none', propertyIds: [] })).status, 200);
  assert.deepEqual(await cleanerPropertyIds({ id: 'c1', ownerId: 'host-1' }), []);
  assert.equal((await scoped(SCOPE, { mode: 'selected', propertyIds: [] })).status, 400);
  assert.equal((await scoped(SCOPE, { mode: 'selected', propertyIds: ['p2'] })).status, 200);
  assert.deepEqual(await cleanerPropertyIds({ id: 'c1', ownerId: 'host-1' }), ['p2']);
  assert.equal((await scoped(SCOPE, { mode: 'all', propertyIds: [] })).status, 200);
  assert.deepEqual(await cleanerPropertyIds({ id: 'c1', ownerId: 'host-1' }), ['p1']);
  assert.equal(db.cleaner[0].publicToken, 'keep'); assert.equal(db.cleaning[0].id, 'history');
  actAsManager(['p1']); assert.equal((await scoped(SCOPE, { mode: 'selected', propertyIds: ['p2'] })).status, 403);
});

test('청소 프로필 연락처 수정은 연결 계정을 동기화하고 비밀번호·실제 이메일을 보존한다', async () => {
  db.user.push({ id: 'u1', role: 'cleaner', email: 'real@example.com', password: 'unchanged', displayName: '이전', phone: '01033334444' });
  db.cleaner = [{ id: 'c1', name: '이전', phone: '01033334444', userId: 'u1', ownerId: 'host-1', publicToken: 'keep' }];
  assert.equal((await callRoute(CLEANER_PUT, makeRequest({ id: 'c1', name: '새 이름', phone: '010-5555-6666' }))).status, 200);
  assert.equal(db.user[1].displayName, '새 이름'); assert.equal(db.user[1].phone, '01055556666');
  assert.equal(db.user[1].email, 'real@example.com'); assert.equal(db.user[1].password, 'unchanged'); assert.equal(db.cleaner[0].publicToken, 'keep');
  db.user[1].email = '01055556666@cleaner.va';
  await callRoute(CLEANER_PUT, makeRequest({ id: 'c1', phone: '01077778888' }));
  assert.equal(db.user[1].email, '01077778888@cleaner.va'); assert.equal(db.user[1].password, 'unchanged');
});

test('전화번호 충돌은 프로필을 변경하지 않고 로그인 재발급은 타 계정을 가져오지 않는다', async () => {
  db.cleaner = [{ id: 'c1', name: '청소', phone: '01033334444', userId: null, ownerId: 'host-1' }];
  db.user.push({ id: 'collision', email: '01033334444@cleaner.va', role: 'admin', password: 'keep' });
  const result = await scoped(RESET, {});
  assert.equal(result.status, 409); assert.equal(db.user[1].password, 'keep'); assert.equal(db.cleaner[0].userId, null);
});

test('계정에서 수정한 청소 담당자 본인 정보도 프로필에 동기화된다', async () => {
  actAsCleaner(['p1']);
  db.user.push({ ...authState.auth.user });
  // actAsCleaner installs the linked profile; use its actual IDs.
  const c = db.cleaner[0];
  const result = await callRoute(USER_PUT, makeRequest({ displayName: '본인 변경', phone: '010-9999-8888' }));
  assert.equal(result.status, 200); assert.equal(c.name, '본인 변경'); assert.equal(c.phone, '01099998888');
});

test('로그인 재발급은 기존 실제 이메일과 청소 프로필 연결을 보존한다', async () => {
  db.user.push({ id: 'u1', role: 'cleaner', email: 'real@example.com', password: 'old', status: 'suspended' });
  db.cleaner = [{ id: 'c1', name: '청소', phone: '01033334444', userId: 'u1', ownerId: 'host-1', publicToken: 'keep' }];
  const result = await scoped(RESET, {});
  assert.equal(result.status, 200); assert.equal(result.body.created, false);
  assert.equal(await bcrypt.compare(result.body.initialPassword, db.user[1].password), true);
  assert.equal(db.user[1].email, 'real@example.com'); assert.equal(db.user[1].status, 'active');
  assert.equal(db.cleaner[0].userId, 'u1'); assert.equal(db.cleaner[0].publicToken, 'keep');
});
