import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { canUseModule, normalizeModuleGrants, isModuleEnabled, moduleForApiPath, moduleForAdminPath, mayUseOperationalPath } from '../lib/operational-permissions';
import { assertOperationalAccess, requestOperationalModule, requestFeatureModules } from '../lib/operational-access';
import { safeAuditDetails, auditData } from '../lib/audit-log';
import { normalizeRole, canManageProperty, getVisiblePropertyIds, canManageCleaner } from '../lib/access';
import { withAuth, ok, requireManage } from '../lib/core/http';
import { db, resetDb } from './stubs/prisma';
import { actAsManager, actAsBusinessAdmin, actAsAdmin, authState } from './stubs/auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';
const mutationRequest = (body: unknown, path: string) => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => { resetDb(); actAsAdmin(); });

test('role boundaries preserve super_admin and fail closed for an ungrouped business administrator', async () => {
  assert.equal(normalizeRole('super_admin'), 'super_admin');
  actAsBusinessAdmin(null);
  assert.deepEqual(await getVisiblePropertyIds(authState.auth), []);
  assert.equal(canManageProperty(authState.auth, 'p1'), false);
  actAsBusinessAdmin('org1', ['p1']);
  assert.equal(canManageProperty(authState.auth, 'p1'), true);
  assert.equal(canManageProperty(authState.auth, 'p2'), false);
  assert.equal(canManageCleaner(authState.auth, { ownerId: null, organizationId: 'org2' }), false);
});

test('explicit empty grants disable manager operations and cleaner grants cannot escalate to guest data', () => {
  assert.equal(canUseModule('manager', [], 'reservations'), false);
  assert.equal(canUseModule('manager', null, 'reservations'), true);
  assert.deepEqual(normalizeModuleGrants(['cleaning', 'reservations', 'cleaning', 'unknown'], 'cleaner'), ['cleaning']);
  assert.equal(canUseModule('cleaner', ['messages'], 'messages'), false);
  assert.equal(canUseModule('super_admin', [], 'messages'), true);
});

test('property overrides cannot re-enable a business entitlement', () => {
  assert.equal(isModuleEnabled('laundry', { laundry: false }, { laundry: true }), false);
  assert.equal(isModuleEnabled('cleaning', { cleaning: true }, { cleaning: false }), false);
  assert.equal(isModuleEnabled('inventory', {}, {}), true);
  assert.throws(() => assertOperationalAccess({ role: 'manager', user: { enabledModules: ['laundry'] }, organizationFeatures: { laundry: false } }, 'laundry'));
  assert.throws(() => assertOperationalAccess({ role: 'admin', user: {}, organizationStatus: 'suspended' }, 'cleaning'));
});

test('API and menu mapping keep read-only cleaning dates separate from reservation writes', () => {
  const auth = { role: 'cleaner' as const, user: { enabledModules: ['cleaning'] } };
  assert.equal(requestOperationalModule(new Request('http://localhost/api/events'), auth), 'cleaning');
  assert.equal(requestOperationalModule(new Request('http://localhost/api/events', { method: 'PUT' }), auth), 'reservations');
  assert.equal(moduleForApiPath('/api/beds24/messages/send', 'POST'), 'messages');
  assert.equal(moduleForApiPath('/api/properties/p1/channels', 'POST'), 'integrations');
  assert.equal(moduleForAdminPath('/admin/inventory'), 'inventory');
});

test('direct API calls to a disabled user module never execute the mutation', async () => {
  actAsManager(['p1']);
  authState.auth.user.enabledModules = [];
  let changed = false;
  const route = withAuth('inventory', async () => { changed = true; return ok({ ok: true }); });
  const res = await callRoute(route, mutationRequest({}, '/api/inventory'));
  assert.equal(res.status, 403);
  assert.equal(changed, false);
  assert.equal(db.auditLog[0].outcome, 'denied');
});

test('business administrators cannot use global-only settings routes', async () => {
  actAsBusinessAdmin('org1', ['p1']);
  const route = withAuth('platform-settings', async () => ok({ ok: true }), { admin: true });
  assert.equal((await callRoute(route, mutationRequest({}, '/api/platform-settings'))).status, 403);
});

test('web activity logs capture the actor and action without message bodies or credentials', async () => {
  actAsManager(['p1']);
  db.property = [{ id: 'p1', name: 'A' }];
  const route = withAuth('inventory', async (_req, { auth }) => { requireManage(auth, 'p1'); return ok({ ok: true }); });
  const res = await callRoute(route, mutationRequest({ propertyId: 'p1', password: 'sensitive', text: 'guest-private', token: 'private-token' }, '/api/inventory'));
  assert.equal(res.status, 200);
  assert.equal(db.auditLog[0].actorId, 'host-1');
  assert.equal(db.auditLog[0].propertyId, 'p1');
  assert.equal(JSON.stringify(db.auditLog).includes('sensitive'), false);
  assert.equal(JSON.stringify(db.auditLog).includes('guest-private'), false);
  const sanitized = safeAuditDetails({ password: 'secret', text: 'private', changedFields: ['name', 'password', 'accessToken'], status: 200 });
  assert.deepEqual(sanitized, { status: 200, changedFields: ['name'] });
  const entry = auditData(authState.auth, { action: 'update', summary: '수정', details: { cookie: 'secret' } });
  assert.deepEqual(entry.details, {});
});

test('a supervisor action on a business property belongs to that business activity feed', async () => {
  actAsAdmin();
  db.property = [{ id: 'p1', organizationId: 'org1', name: 'A' }];
  const route = withAuth('inventory', async () => ok({ ok: true }));
  const res = await callRoute(route, mutationRequest({ propertyId: 'p1' }, '/api/inventory'));
  assert.equal(res.status, 200);
  assert.equal(db.auditLog[0].organizationId, 'org1');
});

test('Beds24 mutation honors the provider option while allowing reservation-only managers', async () => {
  actAsManager(['p1']);
  authState.auth.user.enabledModules = ['reservations'];
  db.property = [{ id: 'p1', organization: { features: { integrations: true }, status: 'active' } }];
  let providerCalls = 0;
  const route = withAuth('beds24/reservations', async () => { providerCalls++; return ok({ ok: true }); });
  assert.deepEqual(requestFeatureModules(mutationRequest({}, '/api/beds24/reservations'), 'reservations'), ['reservations', 'integrations']);
  assert.equal((await callRoute(route, mutationRequest({ propertyId: 'p1' }, '/api/beds24/reservations'))).status, 200);
  db.property[0].organization.features.integrations = false;
  assert.equal((await callRoute(route, mutationRequest({ propertyId: 'p1' }, '/api/beds24/reservations'))).status, 403);
  assert.equal(providerCalls, 1);
  authState.auth.organizationFeatures = { integrations: false };
  assert.equal((await callRoute(route, mutationRequest({}, '/api/beds24/reservations'))).status, 403);
  assert.equal(providerCalls, 1);
});

test('UI path guards honor business options even for administrators and keep personal settings accessible', () => {
  assert.equal(mayUseOperationalPath({ role: 'admin', organizationFeatures: { laundry: false } }, '/admin/laundry'), false);
  assert.equal(mayUseOperationalPath({ role: 'super_admin', organizationFeatures: { laundry: false } }, '/admin/laundry'), true);
  assert.equal(mayUseOperationalPath({ role: 'manager', enabledModules: [] }, '/admin/settings/profile'), true);
  assert.equal(mayUseOperationalPath({ role: 'manager', enabledModules: [] }, '/cleaner'), false);
  assert.equal(mayUseOperationalPath({ role: 'cleaner', enabledModules: ['cleaning'] }, '/cleaner/issues'), false);
  assert.equal(mayUseOperationalPath({ role: 'cleaner', enabledModules: ['cleaning'] }, '/cleaner/supplies'), false);
});

test('supervisor user creation and integration changes retain the target business in web activity', async () => {
  actAsAdmin();
  const createUser = withAuth('staff/create-cleaner', async () => {
    db.user = [{ id: 'new-staff', organizationId: 'org1' }];
    return ok({ cleanerId: 'new-staff', initialPassword: 'private-password' });
  });
  assert.equal((await callRoute(createUser, mutationRequest({}, '/api/staff'))).status, 200);
  assert.equal(db.auditLog[0].organizationId, 'org1');
  assert.equal(db.auditLog[0].targetId, 'new-staff');
  assert.equal(JSON.stringify(db.auditLog).includes('private-password'), false);
  db.property = [{ id: 'p1', organizationId: 'org1' }];
  db.integration = [{ id: 'integration1', propertyId: 'p1' }];
  const changeIntegration = withAuth('integrations', async () => ok({ ok: true }));
  assert.equal((await callRoute(changeIntegration, mutationRequest({ id: 'integration1', config: { token: 'private-token' } }, '/api/integrations'))).status, 200);
  assert.equal(db.auditLog[1].organizationId, 'org1');
  assert.equal(db.auditLog[1].propertyId, 'p1');
  assert.equal(JSON.stringify(db.auditLog).includes('private-token'), false);
});
