import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptInvitation, renewInvitation, revokeInvitation } from '../lib/invitation-lifecycle';
import { POST as ACCEPT } from '../app/api/invitations/[token]/accept/route';
import { GET as INVITATION } from '../app/api/invitations/[token]/route';
import { db, resetDb, prismaOverrides } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin, authState } from './stubs/auth';

const token = 'invitation-token';
const actor = () => db.user.find(row => row.id === 'signup')!;
const invitation = () => db.invitation[0];
function signIn(id = 'signup') {
  const user = db.user.find(row => row.id === id)!;
  authState.auth = { role: user.role, user: { ...user }, session: { userId: user.id, email: user.email }, propertyIds: [] };
  return authState.auth;
}
const rejectedWith = (status: number) => (error: any) => error.status === status;
async function route(handler: any, value = token) {
  return handler(new Request(`http://localhost/api/invitations/${value}`, { method: handler === ACCEPT ? 'POST' : 'GET' }), { params: Promise.resolve({ token: value }) });
}
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.organization = [{ id: 'o1', name: '사업자1', status: 'active' }, { id: 'o2', name: '사업자2', status: 'active' }];
  db.property = [{ id: 'p1', organizationId: 'o1' }, { id: 'p2', organizationId: 'o2' }];
  db.user = [{ id: 'signup', email: 'Guest@Example.com', password: 'existing-password-hash', role: 'manager', status: 'pending_invite', organizationId: null, enabledModules: [], accessVersion: 1, publicToken: 'original-signup-token' }];
  db.userProperty = [];
  db.invitation = [{ id: 'i1', token, email: 'guest@example.com', role: 'manager', organizationId: 'o1', propertyIds: ['p1'], cleanerId: null, status: 'pending', invitedBy: 'business-admin-1', expiresAt: new Date(Date.now() + 86400_000) }];
});

test('선가입한 대기 계정도 이메일 소유자 인증 후 초대 소속·지점을 적용하고 수락 재시도는 중복 변경하지 않는다', async () => {
  const first = await acceptInvitation(signIn(), token);
  assert.equal(first.id, 'signup'); assert.equal(first.status, 'active'); assert.equal(first.organizationId, 'o1');
  assert.equal(actor().enabledModules, null); assert.equal(actor().password, 'existing-password-hash');
  assert.deepEqual(db.userProperty.map(row => [row.userId, row.propertyId]), [['signup', 'p1']]);
  assert.equal(invitation().status, 'accepted'); assert.equal(actor().accessVersion, 2); assert.equal(db.auditLog.length, 1);
  await acceptInvitation(signIn(), token);
  assert.equal(actor().accessVersion, 2); assert.equal(db.auditLog.length, 1);
});

test('사업자 관리자 초대도 선가입 대기 계정을 사업자 관리자에 연결한다', async () => {
  invitation().role = 'admin'; invitation().propertyIds = [];
  const user = await acceptInvitation(signIn(), token);
  assert.equal(user.role, 'admin'); assert.equal(user.organizationId, 'o1'); assert.deepEqual(user.properties, []);
});

test('같은 사업자의 기존 매니저가 같은 역할 초대를 수락해도 제한된 메뉴는 유지한다', async () => {
  Object.assign(actor(), { status: 'active', organizationId: 'o1', enabledModules: ['cleaning'] });
  await acceptInvitation(signIn(), token);
  assert.deepEqual(actor().enabledModules, ['cleaning']); assert.equal(actor().status, 'active'); assert.equal(actor().organizationId, 'o1');
});

test('다른 이메일·정지된 로그인·정지된 실제 계정은 초대를 소비하지 않는다', async () => {
  const auth = signIn(); auth.user.email = 'guest@example.com'; actor().email = 'other@example.com';
  await assert.rejects(acceptInvitation(auth, token), rejectedWith(403));
  actor().email = 'guest@example.com'; auth.user.status = 'suspended';
  await assert.rejects(acceptInvitation(auth, token), rejectedWith(403));
  auth.user.status = 'active'; actor().status = 'suspended';
  await assert.rejects(acceptInvitation(auth, token), rejectedWith(403));
  assert.equal(invitation().status, 'pending'); assert.equal(actor().accessVersion, 1); assert.equal((db.auditLog ?? []).length, 0);
});

test('기존 다른 사업자 직원과 기존 관리자는 초대 링크로 소속·역할을 변경할 수 없다', async () => {
  for (const values of [{ role: 'manager', organizationId: 'o2' }, { role: 'admin', organizationId: 'o1' }, { role: 'super_admin', organizationId: null }]) {
    Object.assign(actor(), values, { status: 'active' });
    await assert.rejects(acceptInvitation(signIn(), token), rejectedWith(403));
    assert.equal(invitation().status, 'pending'); assert.equal(actor().accessVersion, 1);
  }
});

test('만료·비활성 사업자·이동한 배정 지점은 수락을 막고 대기 계정과 초대를 유지한다', async () => {
  invitation().expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(acceptInvitation(signIn(), token), rejectedWith(410));
  invitation().expiresAt = new Date(Date.now() + 86400_000); db.organization[0].status = 'inactive';
  await assert.rejects(acceptInvitation(signIn(), token), rejectedWith(403));
  db.organization[0].status = 'active'; db.property[0].organizationId = 'o2';
  await assert.rejects(acceptInvitation(signIn(), token), rejectedWith(409));
  assert.equal(invitation().status, 'pending'); assert.equal(actor().status, 'pending_invite'); assert.deepEqual(db.userProperty, []);
});

test('청소 직원의 선가입 로그인 연결은 수행 기록·배정·기존 메뉴를 보존하고 실제 직원 ID로 세션 응답한다', async () => {
  db.user.push({ id: 'staff', email: 'staff@accounts.invalid', role: 'cleaner', status: 'no_account', organizationId: 'o1', enabledModules: ['cleaning'], publicToken: 'staff-token', accessVersion: 7 });
  db.userProperty = [{ userId: 'staff', propertyId: 'p1' }];
  db.cleaning = [{ id: 'historical', cleanerId: 'staff', propertyId: 'p1', status: 'done' }];
  invitation().role = 'cleaner'; invitation().cleanerId = 'staff'; invitation().propertyIds = [];
  signIn(); const response = await route(ACCEPT);
  assert.equal(response.status, 200); assert.equal(response.body.user.id, 'staff'); assert.equal(response.body.profile.organizationId, 'o1');
  const staff = db.user.find(row => row.id === 'staff')!;
  assert.equal(staff.email, 'Guest@Example.com'); assert.equal(staff.password, 'existing-password-hash'); assert.equal(staff.status, 'active');
  assert.deepEqual(staff.enabledModules, ['cleaning']); assert.equal(staff.publicToken, 'staff-token'); assert.equal(staff.accessVersion, 8);
  assert.equal(actor().status, 'suspended'); assert.equal(actor().email, 'archived-invite-signup@accounts.invalid');
  assert.equal(db.cleaning[0].cleanerId, 'staff'); assert.deepEqual(db.userProperty, [{ userId: 'staff', propertyId: 'p1' }]);
  assert.equal(db.auditLog[0].targetId, 'staff'); assert.equal(response.body.user.password, undefined);
});

test('연결 대상 청소 직원의 소속이 바뀌었으면 초대 선점도 롤백한다', async () => {
  db.user.push({ id: 'staff', role: 'cleaner', status: 'no_account', organizationId: 'o2', accessVersion: 1 });
  invitation().role = 'cleaner'; invitation().cleanerId = 'staff'; invitation().propertyIds = [];
  await assert.rejects(acceptInvitation(signIn(), token), rejectedWith(409));
  assert.equal(invitation().status, 'pending'); assert.equal(actor().email, 'Guest@Example.com'); assert.equal(actor().status, 'pending_invite');
  assert.equal(db.user.find(row => row.id === 'staff')!.status, 'no_account'); assert.equal((db.auditLog ?? []).length, 0);
});

test('동일 계정의 동시 수락은 한 번만 권한을 적용한다', async () => {
  const auth = signIn(); const users = await Promise.all([acceptInvitation(auth, token), acceptInvitation(auth, token)]);
  assert.deepEqual(users.map(user => user.id), ['signup', 'signup']); assert.equal(actor().accessVersion, 2); assert.equal(db.auditLog.length, 1); assert.equal(db.userProperty.length, 1);
});

test('만료 초대 재발급은 링크를 회전해 이전 링크를 무효화하며 토큰을 응답·활동 로그 본문에 노출하지 않는다', async () => {
  invitation().expiresAt = new Date(Date.now() - 1000); invitation().status = 'expired';
  actAsAdmin(); const renewed = await renewInvitation(authState.auth, token, 'https://host.example');
  const newToken = renewed.invitationUrl.split('/').at(-1)!;
  assert.notEqual(newToken, token); assert.equal(invitation().token, newToken); assert.equal(invitation().status, 'pending');
  assert.ok(invitation().expiresAt.getTime() > Date.now() + 6 * 86400_000); assert.equal((renewed.invitation as any).token, undefined);
  assert.equal(JSON.stringify(db.auditLog).includes(newToken), false); assert.equal((await route(INVITATION, token)).status, 404); assert.equal((await route(INVITATION, newToken)).status, 200);
});

test('회수는 재시도해도 로그를 중복 생성하지 않고 수락·재발급을 차단한다', async () => {
  actAsAdmin(); const auth = authState.auth;
  await revokeInvitation(auth, token); await revokeInvitation(auth, token);
  assert.equal(invitation().status, 'revoked'); assert.equal(db.auditLog.length, 1);
  await assert.rejects(renewInvitation(auth, token, 'https://host.example'), rejectedWith(409));
  await assert.rejects(acceptInvitation(signIn(), token), rejectedWith(404));
});

test('사업자 관리자는 자기 직원 초대만 관리하고 수락된 초대는 재발급·회수할 수 없다', async () => {
  actAsBusinessAdmin('o2'); await assert.rejects(renewInvitation(authState.auth, token, 'https://host.example'), rejectedWith(403)); await assert.rejects(revokeInvitation(authState.auth, token), rejectedWith(403));
  actAsBusinessAdmin('o1'); invitation().role = 'admin'; await assert.rejects(revokeInvitation(authState.auth, token), rejectedWith(403));
  actAsAdmin(); invitation().status = 'accepted'; await assert.rejects(renewInvitation(authState.auth, token, 'https://host.example'), rejectedWith(409)); await assert.rejects(revokeInvitation(authState.auth, token), rejectedWith(409));
});

test('활동 저장 실패 시 수락·재발급·회수 각각 계정과 초대를 모두 롤백한다', async () => {
  prismaOverrides.auditLog = { create: async () => { throw new Error('activity unavailable'); } };
  await assert.rejects(acceptInvitation(signIn(), token), /activity unavailable/);
  assert.equal(invitation().status, 'pending'); assert.equal(actor().status, 'pending_invite'); assert.equal(actor().organizationId, null); assert.deepEqual(db.userProperty, []);
  actAsAdmin(); await assert.rejects(renewInvitation(authState.auth, token, 'https://host.example'), /activity unavailable/);
  assert.equal(invitation().token, token); await assert.rejects(revokeInvitation(authState.auth, token), /activity unavailable/); assert.equal(invitation().status, 'pending');
});
