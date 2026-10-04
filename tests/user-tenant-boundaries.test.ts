import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as USERS, PUT as UPDATE_USER } from '../app/api/users/route';
import { GET as ASSIGNEES } from '../app/api/cleaners/route';
import { POST as CREATE_PROPERTY } from '../app/api/properties/route';
import { POST as REGISTER } from '../app/api/auth/register/route';
import { POST as CREATE_MESSAGE } from '../app/api/messages/route';
import { POST as CREATE_INTEGRATION } from '../app/api/integrations/route';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin, actAsManager, authState } from './stubs/auth';
import { callRoute } from './helpers/beds24-mock';

const request = (path: string, body?: unknown) => new Request(`http://localhost${path}`, body === undefined ? {} : {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  resetDb();
  db.organization = [{ id: 'org1', status: 'active' }, { id: 'org2', status: 'active' }];
  db.property = [{ id: 'p1', name: 'A', organizationId: 'org1' }, { id: 'p2', name: 'B', organizationId: 'org2' }];
  db.user = [
    { id: 'super', role: 'super_admin', status: 'active', email: 'super@example.com' },
    { id: 'u1', role: 'manager', status: 'active', organizationId: 'org1', displayName: 'A manager' },
    { id: 'u2', role: 'manager', status: 'active', organizationId: 'org2', displayName: 'B manager' },
    { id: 'c1', role: 'cleaner', status: 'active', organizationId: 'org1', displayName: 'A cleaner', ownerId: 'other-manager', publicToken: 'private-a' },
    { id: 'c2', role: 'cleaner', status: 'active', organizationId: 'org2', displayName: 'B cleaner', publicToken: 'private-b' },
  ];
  db.userProperty = [{ userId: 'u1', propertyId: 'p1' }, { userId: 'u2', propertyId: 'p2' }, { userId: 'c1', propertyId: 'p1' }, { userId: 'c2', propertyId: 'p2' }];
  actAsBusinessAdmin('org1', ['p1']);
});

test('business account lists and assignees stay in the organization even with stale cross-business assignment', async () => {
  db.userProperty.push({ userId: 'c2', propertyId: 'p1' });
  const users = await callRoute(USERS, request('/api/users'));
  assert.equal(users.status, 200);
  assert.deepEqual(users.body.map((row: { id: string }) => row.id), ['u1']);
  const assignees = await callRoute(ASSIGNEES, request('/api/cleaners'));
  assert.equal(assignees.status, 200);
  assert.deepEqual(assignees.body.map((row: { id: string }) => row.id).sort(), ['c1', 'u1']);
  assert.equal(JSON.stringify(assignees.body).includes('private-b'), false);
});

test('a business administrator cannot edit another organization or promote a manager to administrator', async () => {
  assert.equal((await callRoute(UPDATE_USER, request('/api/users', { id: 'u2', displayName: 'changed' }))).status, 403);
  assert.equal((await callRoute(UPDATE_USER, request('/api/users', { id: 'u1', role: 'admin' }))).status, 403);
  assert.equal(db.user.find(user => user.id === 'u2')?.displayName, 'B manager');
  assert.equal(db.user.find(user => user.id === 'u1')?.role, 'manager');
});

test('business administrators and managers cannot create a branch directly', async () => {
  const count = db.property.length;
  assert.equal((await callRoute(CREATE_PROPERTY, request('/api/properties', { name: 'unauthorized branch' }))).status, 403);
  actAsManager(['p1']); authState.auth.user.organizationId = 'org1';
  assert.equal((await callRoute(CREATE_PROPERTY, request('/api/properties', { name: 'unauthorized branch' }))).status, 403);
  assert.equal(db.property.length, count);
});

test('a manager may manage assigned cleaning staff and integrations without being the original creator', async () => {
  actAsManager(['p1']); authState.auth.user.organizationId = 'org1';
  assert.equal((await callRoute(UPDATE_USER, request('/api/users', { id: 'c1', displayName: 'updated cleaner' }))).status, 200);
  const integration = await callRoute(CREATE_INTEGRATION, request('/api/integrations', { propertyId: 'p1', provider: 'airbnb', type: 'ical', config: {} }));
  assert.equal(integration.status, 201);
  db.userProperty.push({ userId: 'c1', propertyId: 'p2' });
  assert.equal((await callRoute(UPDATE_USER, request('/api/users', { id: 'c1', displayName: 'must not update' }))).status, 403);
});

test('a message cannot attach a foreign reservation to an allowed property', async () => {
  db.event = [{ id: 'e2', propertyId: 'p2' }];
  assert.equal((await callRoute(CREATE_MESSAGE, request('/api/messages', { propertyId: 'p1', eventId: 'e2', text: 'test', sender: 'host' }))).status, 400);
  assert.equal((db.message || []).length, 0);
});

test('knowing an invited email does not claim an administrator invitation without its token', async () => {
  actAsAdmin();
  db.invitation = [{ id: 'inv', token: 'private-invitation', email: 'invited@example.com', role: 'admin', organizationId: 'org1', status: 'pending', expiresAt: new Date(Date.now() + 60_000) }];
  const result = await callRoute(REGISTER, request('/api/auth/register', { email: 'invited@example.com', password: 'test-password', displayName: 'New user' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.profile.role, 'manager');
  assert.equal(result.body.profile.status, 'pending_invite');
  assert.equal(db.invitation[0].status, 'pending');
});

test('the correct invitation token creates an administrator only in its specified business', async () => {
  db.invitation = [{ id: 'inv', token: 'private-invitation', email: 'admin-invited@example.com', role: 'admin', organizationId: 'org2', status: 'pending', expiresAt: new Date(Date.now() + 60_000) }];
  const result = await callRoute(REGISTER, request('/api/auth/register', { email: 'admin-invited@example.com', password: 'test-password', invitationToken: 'private-invitation' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.profile.role, 'admin');
  assert.equal(result.body.profile.organizationId, 'org2');
  assert.equal(db.invitation[0].status, 'accepted');
});
