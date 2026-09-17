import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, authState } from './stubs/auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';
import { GET as STAFF, POST as CREATE } from '../app/api/staff/route';
import { PUT as UPDATE } from '../app/api/users/route';
import { GET as ASSIGNEES } from '../app/api/cleaners/route';
import { POST as ASSIGN, PUT as COMPLETE } from '../app/api/cleanings/route';
import { POST as APPLY } from '../app/api/cleaning-applications/route';
import { POST as RESET } from '../app/api/cleaners/[id]/reset-password/route';
import { getVisiblePropertyIds, getCleaningPropertyIds, canManageProperty } from '../lib/access';
import { POST as REGISTER } from '../app/api/auth/register/route';
import { POST as INVITE } from '../app/api/cleaners/[id]/invite/route';

beforeEach(() => {
  resetDb(); actAsManager(['p1']);
  db.user = [{ ...authState.auth.user, displayName: '민들레', phone: '01011112222', password: 'secret', publicToken: 'keep' }, { id: 'admin-1', role: 'admin', status: 'active', email: 'admin@test.com', displayName: '관리자', password: 'admin-secret' }];
  db.property = [{ id: 'p1', name: '담당 숙소', ownerId: 'host-1' }, { id: 'p2', name: '다른 숙소', ownerId: 'other' }];
  db.userProperty = [{ userId: 'host-1', propertyId: 'p1' }];
});

test('users만 등록된 매니저가 별도 역할 추가 없이 청소 담당자 목록에 나타난다', async () => {
  const staff = (await callRoute(STAFF, makeRequest({}))).body.staff;
  assert.equal(staff.length, 1); assert.equal(staff[0].userId, 'host-1'); assert.deepEqual(staff[0].roles, ['manager']);
  const people = (await callRoute(ASSIGNEES, makeRequest({}))).body;
  assert.ok(people.some((u: any) => u.id === 'host-1'));
  assert.doesNotMatch(JSON.stringify(people), /secret/);
  assert.equal(db.cleaner, undefined);
});

test('관리와 청소는 같은 숙소 배정이며 빈 배정은 접근 없음이다', async () => {
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), ['p1']);
  assert.deepEqual(await getCleaningPropertyIds(authState.auth), ['p1']);
  assert.equal(canManageProperty(authState.auth, 'p2'), false);
  actAsCleaner([]); assert.deepEqual(await getCleaningPropertyIds(authState.auth), []);
  actAsAdmin(); assert.deepEqual((await getCleaningPropertyIds(authState.auth)).sort(), ['p1', 'p2']);
});

test('매니저가 직접 신청·완료하고 사용자 ID가 청소에 저장된다', async () => {
  db.cleaning = [{ id: 'job', propertyId: 'p1', date: '2026-10-01', cleanerId: null, status: 'pending', isOpen: true }];
  assert.equal((await callRoute(APPLY, makeRequest({ cleaningId: 'job' }))).status, 201);
  assert.equal(db.cleaning[0].cleanerId, 'host-1'); assert.equal(db.cleaningApplication[0].applicantId, 'host-1');
  assert.equal((await callRoute(COMPLETE, makeRequest({ id: 'job', status: 'done' }))).status, 200);
  assert.equal(db.user[0].role, 'manager'); assert.equal(db.user[0].password, 'secret');
});

test('직접 배정은 숙소 범위 밖·중지된 직원을 거부한다', async () => {
  db.user.push({ id: 'out', role: 'cleaner', status: 'active', email: 'out@test.com' });
  actAsAdmin();
  assert.equal((await callRoute(ASSIGN, makeRequest({ propertyId: 'p1', date: '2026-10-01', cleanerId: 'out' }))).status, 400);
  db.user[0].status = 'suspended';
  assert.equal((await callRoute(ASSIGN, makeRequest({ propertyId: 'p1', date: '2026-10-01', cleanerId: 'host-1' }))).status, 400);
});

test('청소 전용 직원은 본인 완료만 가능하고 예약 관리 권한은 없다', async () => {
  actAsCleaner(['p1']);
  db.cleaning = [{ id: 'own', propertyId: 'p1', cleanerId: 'cleaner-1' }, { id: 'other', propertyId: 'p1', cleanerId: 'host-1' }];
  assert.equal((await callRoute(COMPLETE, makeRequest({ id: 'own', status: 'done' }))).status, 200);
  assert.equal((await callRoute(COMPLETE, makeRequest({ id: 'other', status: 'done' }))).status, 403);
  assert.equal((await callRoute(COMPLETE, makeRequest({ id: 'own', cleanerId: 'host-1' }))).status, 403);
  assert.equal(canManageProperty(authState.auth, 'p1'), false);
});

test('전화번호 변경은 users 하나만 수정하고 기존 로그인 비밀번호·이메일·일정 링크를 유지한다', async () => {
  assert.equal((await callRoute(UPDATE, makeRequest({ displayName: '민들레', phone: '010-9999-8888' }))).status, 200);
  assert.equal(db.user[0].phone, '01099998888'); assert.equal(db.user[0].password, 'secret'); assert.equal(db.user[0].email, 'host@test'); assert.equal(db.user[0].publicToken, 'keep');
  assert.equal(db.cleaner, undefined);
});

test('로그인 없는 직원도 users에 한 번 생성하며 비밀번호 발급은 같은 row를 활성화한다', async () => {
  const result = await callRoute(CREATE, makeRequest({ name: '새 직원', phone: '01033334444', mode: 'selected', propertyIds: ['p1'], loginEnabled: false, notifyNewOpen: true }));
  assert.equal(result.status, 201);
  const person = db.user.find(u => u.id === result.body.cleanerId)!;
  assert.equal(person.status, 'no_account'); assert.equal(person.password, ''); assert.equal(db.cleaner, undefined);
  const count = db.user.length;
  const reset = await callRoute(req => RESET(req, { params: Promise.resolve({ id: person.id }) }), makeRequest({}));
  assert.equal(reset.status, 200); assert.equal(db.user.length, count); assert.equal(person.status, 'active');
  assert.equal(await bcrypt.compare(reset.body.initialPassword, person.password), true);
});

test('관리자만 관리 역할을 바꾸고 매니저는 자신의 청소 직원을 관리한다', async () => {
  db.user.push({ id: 'staff', role: 'cleaner', status: 'active', ownerId: 'host-1', email: 'staff@test.com' });
  assert.equal((await callRoute(UPDATE, makeRequest({ id: 'staff', phone: '01044445555', role: 'admin' }))).status, 200);
  assert.equal(db.user[2].role, 'cleaner');
  assert.equal((await callRoute(UPDATE, makeRequest({ id: 'staff', propertyIds: ['p2'] }))).status, 403);
  actAsAdmin(); assert.equal((await callRoute(UPDATE, makeRequest({ id: 'staff', role: 'manager', propertyIds: ['p1'] }))).status, 200);
  assert.equal(db.user[2].role, 'manager');
});

test('이메일 초대 수락은 로그인 없는 User를 활성화하고 청소 이력·숙소를 유지한다', async () => {
  db.user.push({ id: 'link-staff', email: 'staff-link@staff.invalid', password: '', displayName: '초대 직원', role: 'cleaner', status: 'no_account', ownerId: 'host-1', publicToken: 'keep-link', phone: '01033334444' });
  db.userProperty.push({ userId: 'link-staff', propertyId: 'p1' });
  db.cleaning = [{ id: 'past', cleanerId: 'link-staff', propertyId: 'p1' }];
  db.invitation = [{ id: 'invite', email: 'invited@example.com', role: 'cleaner', status: 'pending', cleanerId: 'link-staff', invitedBy: 'host-1', expiresAt: new Date(Date.now() + 60000) }];
  const count = db.user.length;
  const result = await callRoute(REGISTER, makeRequest({ email: 'invited@example.com', password: 'safe-password', displayName: '초대 직원' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.user.id, 'link-staff'); assert.equal(db.user.length, count);
  assert.deepEqual(result.body.profile.propertyIds, ['p1']);
  assert.equal(db.cleaning[0].cleanerId, 'link-staff'); assert.equal(db.user[2].publicToken, 'keep-link');
  assert.equal(db.user[2].phone, '01033334444'); assert.equal(db.user[2].status, 'active');
});

test('매니저는 본인이 등록했어도 관리 역할로 승격된 직원의 로그인 초대를 발급할 수 없다', async () => {
  db.user.push({ id: 'promoted', email: 'promoted@staff.invalid', password: '', role: 'admin', status: 'no_account', ownerId: 'host-1' });
  const result = await callRoute(req => INVITE(req, { params: Promise.resolve({ id: 'promoted' }) }), makeRequest({ email: 'promoted@example.com' }));
  assert.equal(result.status, 403); assert.equal((db.invitation || []).length, 0);
});
