import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { POST as CREATE, GET as USERS } from '../app/api/users/route';
import { POST as LOGIN } from '../app/api/auth/login/route';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous, authState } from './stubs/auth';
import { makeRequest, callRoute } from './helpers/beds24-mock';

const body = { displayName: ' 담당자 ', email: ' Staff@Example.com ', phone: '010-1234-5678', password: 'new-password-123', role: 'manager', propertyIds: ['p1', 'p1'] };
beforeEach(() => { resetDb(); actAsAdmin(); db.property = [{ id: 'p1', name: '한옥' }]; });

test('관리자 직접 등록은 활성 계정·암호화 비밀번호·숙소 배정을 만들고 즉시 로그인이 가능하다', async () => {
  const originalSession = authState.auth;
  const result = await callRoute(CREATE, makeRequest(body));
  assert.equal(result.status, 201);
  assert.equal(result.body.email, 'staff@example.com'); assert.equal(result.body.displayName, '담당자');
  assert.equal(result.body.status, 'active'); assert.deepEqual(result.body.propertyIds, ['p1']);
  assert.equal(result.body.phone, '01012345678'); assert.equal(db.user[0].phone, '01012345678');
  assert.equal(result.body.password, undefined); assert.equal(db.userProperty.length, 1);
  assert.notEqual(db.user[0].password, body.password);
  assert.equal(await bcrypt.compare(body.password, db.user[0].password), true);
  assert.equal(authState.auth, originalSession);
  const users = await callRoute(USERS, makeRequest({}));
  assert.equal(users.body[0].id, result.body.id);
  assert.equal(users.body[0].phone, '01012345678');
  const login = await callRoute(LOGIN, makeRequest({ email: result.body.email, password: body.password }));
  assert.equal(login.status, 200); assert.equal(login.body.profile.status, 'active');
});

test('동일 이메일 대기 초대는 종료하고 직접 지정한 역할·숙소만 적용한다', async () => {
  db.invitation = [{ id: 'i1', email: 'STAFF@example.com', role: 'admin', status: 'pending', propertyIds: ['p2'] }, { id: 'i2', email: 'other@example.com', status: 'pending' }];
  assert.equal((await callRoute(CREATE, makeRequest(body))).status, 201);
  assert.equal(db.invitation[0].status, 'expired'); assert.equal(db.invitation[1].status, 'pending');
  assert.equal(db.user[0].role, 'manager'); assert.equal(db.userProperty[0].propertyId, 'p1');
});

test('관리자는 별도 숙소 배정 없이 등록한다', async () => {
  const result = await callRoute(CREATE, makeRequest({ ...body, role: 'admin', phone: '+82 10-1234-5678' }));
  assert.equal(result.status, 201); assert.deepEqual(result.body.propertyIds, []);
  assert.equal(result.body.phone, '01012345678');
  assert.equal((db.userProperty ?? []).length, 0);
});

test('관리자 외에는 직접 등록할 수 없다', async () => {
  for (const actor of [() => actAsManager(['p1']), () => actAsCleaner(['p1']), actAsAnonymous]) {
    actor();
    assert.equal((await callRoute(CREATE, makeRequest(body))).status, actor === actAsAnonymous ? 401 : 403);
  }
  assert.equal((db.user ?? []).length, 0);
});

test('중복 이메일은 대소문자를 구분하지 않고 거부하며 기존 계정을 변경하지 않는다', async () => {
  db.user = [{ id: 'existing', email: 'STAFF@EXAMPLE.COM', password: 'old', status: 'suspended' }];
  assert.equal((await callRoute(CREATE, makeRequest(body))).status, 409);
  assert.equal(db.user.length, 1); assert.equal(db.user[0].password, 'old'); assert.equal(db.user[0].status, 'suspended');
});

test('유효하지 않은 입력·숙소·청소담당자 계정은 사용자 생성 전에 거부한다', async () => {
  for (const phone of [undefined, null, '', ' ', '010-123-4567', '02-1234-5678', '010abcdefgh']) {
    assert.equal((await callRoute(CREATE, makeRequest({ ...body, phone }))).status, 400);
  }
  for (const invalid of [null, [], { ...body, role: 'cleaner' }, { ...body, displayName: ' ' }, { ...body, email: 'invalid' }, { ...body, password: 'short' }, { ...body, password: '가'.repeat(25) }, { ...body, propertyIds: ['missing'] }, { ...body, status: 'active' }]) {
    assert.equal((await callRoute(CREATE, makeRequest(invalid))).status, 400);
  }
  db.invitation = [{ id: 'cleaner-invite', email: 'staff@example.com', role: 'cleaner', status: 'pending' }];
  assert.equal((await callRoute(CREATE, makeRequest(body))).status, 400);
  assert.equal((db.user ?? []).length, 0);
});
