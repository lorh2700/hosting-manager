import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/auth/register/route';
import { db, prisma, prismaOverrides, resetDb } from './stubs/prisma';
import { makeRequest, callRoute } from './helpers/beds24-mock';

beforeEach(() => {
  resetDb();
  db.user = [{ id: 'existing-owner', email: 'owner@example.com', role: 'super_admin', status: 'active' }];
  db.organization = [{ id: 'o1', status: 'active', features: {} }];
  db.property = [{ id: 'p1', organizationId: 'o1' }];
  db.invitation = [{ id: 'inv', token: 'old-link', email: 'invited@example.com', role: 'manager', organizationId: 'o1', propertyIds: ['p1'], invitedBy: 'existing-owner', status: 'pending', expiresAt: new Date(Date.now() + 60_000) }];
});
const register = () => callRoute(POST, makeRequest({ email: 'invited@example.com', password: 'private-password', invitationToken: 'old-link' }, 'http://localhost/api/auth/register'));
function intervene(work: () => void) {
  const transaction = prisma.$transaction;
  prismaOverrides.$transaction = async (run: any, options: any) => { assert.equal(options.isolationLevel, 'Serializable'); work(); return transaction(run, options); };
}

test('가입 시작 후 초대를 재발급했다면 이전 링크로 계정을 만들거나 새 초대를 소비하지 않는다', async () => {
  intervene(() => { db.invitation[0].token = 'renewed-link'; });
  const response = await register();
  assert.equal(response.status, 409); assert.equal(db.invitation[0].token, 'renewed-link'); assert.equal(db.invitation[0].status, 'pending'); assert.equal(db.user.length, 1);
});

test('가입 시작 후 사업자가 중지되면 권한 적용을 멈춘다', async () => {
  intervene(() => { db.organization[0].status = 'inactive'; });
  assert.equal((await register()).status, 403); assert.equal(db.invitation[0].status, 'pending'); assert.equal(db.user.length, 1);
});

test('가입 시작 후 초대에 배정된 지점이 다른 사업자로 이동하면 권한 적용을 멈춘다', async () => {
  intervene(() => { db.property[0].organizationId = 'o2'; });
  assert.equal((await register()).status, 409); assert.equal(db.invitation[0].status, 'pending'); assert.equal(db.user.length, 1);
});

test('가입 시 초대 수락 활동 기록을 저장할 수 없으면 계정·배정·초대 모두 롤백한다', async () => {
  prismaOverrides.auditLog = { create: async () => { throw new Error('audit unavailable'); } };
  const response = await register();
  assert.equal(response.status, 500); assert.equal(db.invitation[0].status, 'pending'); assert.equal(db.user.length, 1); assert.equal((db.userProperty ?? []).length, 0);
});
