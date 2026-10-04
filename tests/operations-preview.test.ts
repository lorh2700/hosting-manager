import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewOperationsApi, createPreviewStore } from '../app/admin/settings/operations/preview-data';
import type { OperationsSnapshot, PropertyRequest } from '../app/admin/settings/operations/types';

const command = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
test('preview scope filters users/properties but retains the supervisor business picker', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin');
  const result = await api<OperationsSnapshot>('/api/admin/operations-settings?organizationId=preview-company-b');
  assert.equal(result.organizations.length, 2); assert.deepEqual(result.properties.map(item => item.id), ['preview-property-b']);
  assert(result.users.every(item => item.organizationId === 'preview-company-b'));
  const unassigned = await api<OperationsSnapshot>('/api/admin/operations-settings?organizationId=__unassigned__');
  assert(unassigned.properties.every(item => item.organizationId === null)); assert(unassigned.users.some(item => item.role === 'super_admin'));
});
test('preview refuses business-crossing feature/user mutations and manager settings access', async () => {
  const store = createPreviewStore(); const original = structuredClone(store); const api = createPreviewOperationsApi(store, 'admin');
  await assert.rejects(api('/api/admin/operations-settings', command('PUT', { organizations: [{ id: 'preview-company-b', version: 1, features: {} }] })), /슈퍼매니저/);
  await assert.rejects(api('/api/admin/user-access/preview-admin-b', command('PATCH', { version: 1, role: 'super_admin', organizationId: null })), /같은 사업자/);
  await assert.rejects(api('/api/admin/operations-settings?organizationId=preview-company-b'), /다른 사업자/);
  await assert.rejects(createPreviewOperationsApi(store, 'manager')('/api/admin/operations-settings'), /사업자 관리자/);
  assert.deepEqual(store, original);
});
test('preview checks versions and preserves all records after a failed batch', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin');
  await api('/api/admin/organizations/preview-company-a', command('PATCH', { version: 1, name: '이름 변경' }));
  await assert.rejects(api('/api/admin/organizations/preview-company-a', command('PATCH', { version: 1, name: '오래된 변경' })), /다른 사용자가/);
  const original = structuredClone(store);
  await assert.rejects(api('/api/admin/operations-settings', command('PUT', { organizations: [{ id: 'preview-company-a', version: 2, features: { laundry: false } }], properties: [{ id: 'missing', version: 1, featureOverrides: {} }] })), /지점을 변경/);
  assert.deepEqual(store, original);
});
test('preview refuses re-enabling a disabled business option at a property', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'admin');
  await assert.rejects(api('/api/admin/operations-settings', command('PUT', { properties: [{ id: 'preview-anon', version: 1, featureOverrides: { priceLabs: true } }] })), /사업자에서 제공하지/);
  assert.equal(store.snapshot.properties[0].version, 1);
});
test('preview supports promoting and demoting other supervisors but blocks self lockout', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin');
  await assert.rejects(api('/api/admin/user-access/preview-super', command('PATCH', { version: 1, role: 'admin', organizationId: 'preview-company-a' })), /본인의 관리자/);
  await api('/api/admin/user-access/preview-super-other', command('PATCH', { version: 1, role: 'admin', organizationId: 'preview-company-a', propertyIds: [] }));
  assert.equal(store.snapshot.users.find(item => item.id === 'preview-super-other')!.role, 'admin');
  await api('/api/admin/user-access/preview-super-other', command('PATCH', { version: 2, role: 'super_admin', organizationId: null, propertyIds: [] }));
  assert.equal(store.snapshot.users.find(item => item.id === 'preview-super-other')!.role, 'super_admin');
});
test('preview moves unassigned staff with their property only with explicit consent', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin');
  const body = { version: 1, propertyIds: ['preview-anon', 'preview-unwadang', 'preview-legacy-property'] };
  await assert.rejects(api('/api/admin/organizations/preview-company-a', command('PATCH', body)), /소속도 함께 이동/);
  assert.equal(store.snapshot.properties.find(item => item.id === 'preview-legacy-property')!.organizationId, null);
  await api('/api/admin/organizations/preview-company-a', command('PATCH', { ...body, migrateAssignedUsers: true }));
  assert.equal(store.snapshot.users.find(item => item.id === 'preview-legacy-cleaner')!.organizationId, 'preview-company-a');
  assert.equal(store.snapshot.properties.find(item => item.id === 'preview-legacy-property')!.organizationId, 'preview-company-a');
});
test('preview rejects a partial staff transfer atomically and permits all assigned properties together', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin'); const original = structuredClone(store);
  await assert.rejects(api('/api/admin/organizations/preview-company-b', command('PATCH', { version: 1, propertyIds: ['preview-property-b', 'preview-anon'], migrateAssignedUsers: true })), /모든 담당 지점/);
  assert.deepEqual(store, original);
  await api('/api/admin/organizations/preview-company-b', command('PATCH', { version: 1, propertyIds: ['preview-property-b', 'preview-anon', 'preview-unwadang'], migrateAssignedUsers: true }));
  assert.equal(store.snapshot.users.find(item => item.id === 'preview-manager-a')!.organizationId, 'preview-company-b');
  assert.deepEqual(store.snapshot.organizations[0].propertyIds, []);
});
test('preview requests filter before limiting and expose all pages without duplicating records', async () => {
  const store = createPreviewStore(); store.requests = Array.from({ length: 121 }, (_, index) => ({ id: `request-${String(index).padStart(3, '0')}`, name: '요청', organizationId: 'preview-company-a', status: 'requested', version: 1, createdAt: '2026-10-04T00:00:00Z' }));
  store.requests.push({ id: 'older-b', name: '이전 미처리 요청', organizationId: 'preview-company-b', status: 'requested', version: 1, createdAt: '2026-01-01T00:00:00Z' });
  const api = createPreviewOperationsApi(store, 'super_admin');
  const b = await api<{ items: PropertyRequest[] }>('/api/admin/property-requests?organizationId=preview-company-b&status=requested'); assert.deepEqual(b.items.map(item => item.id), ['older-b']);
  const collected: string[] = []; let cursor: string | null = null;
  do { const result: { items: PropertyRequest[]; nextCursor: string | null; hasMore: boolean } = await api(`/api/admin/property-requests?organizationId=preview-company-a&status=requested&pageSize=50${cursor ? `&cursor=${cursor}` : ''}`); collected.push(...result.items.map(item => item.id)); cursor = result.nextCursor; } while (cursor);
  assert.equal(collected.length, 121); assert.equal(new Set(collected).size, 121);
});
test('preview excludes supervisors from staff transfers and refuses moving business administrators', async () => {
  const store = createPreviewStore(); store.snapshot.users.find(item => item.id === 'preview-super-other')!.propertyIds = ['preview-legacy-property'];
  const api = createPreviewOperationsApi(store, 'super_admin');
  await api('/api/admin/organizations/preview-company-a', command('PATCH', { version: 1, propertyIds: ['preview-anon', 'preview-unwadang', 'preview-legacy-property'], migrateAssignedUsers: true }));
  assert.equal(store.snapshot.users.find(item => item.id === 'preview-super-other')!.organizationId, null);
  store.snapshot.users.find(item => item.id === 'preview-admin-a')!.propertyIds = ['preview-legacy-property']; const original = structuredClone(store);
  await assert.rejects(api('/api/admin/organizations/preview-company-b', command('PATCH', { version: 1, propertyIds: ['preview-property-b', 'preview-legacy-property'], migrateAssignedUsers: true })), /다른 사업자의 관리자/);
  assert.deepEqual(store, original);
});
test('preview moves a business-unassigned administrator only with explicit consent and preserves the role', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin'); const original = structuredClone(store);
  const body = { version: 1, propertyIds: ['preview-anon', 'preview-unwadang', 'preview-legacy-property'] };
  await assert.rejects(api('/api/admin/organizations/preview-company-a', command('PATCH', body)), /소속도 함께 이동/);
  assert.deepEqual(store, original);
  await api('/api/admin/organizations/preview-company-a', command('PATCH', { ...body, migrateAssignedUsers: true }));
  const admin = store.snapshot.users.find(item => item.id === 'preview-legacy-admin')!;
  assert.equal(admin.organizationId, 'preview-company-a'); assert.equal(admin.role, 'admin'); assert.equal(admin.version, 2);
});
test('preview refuses a partial unassigned administrator transfer without changing any record', async () => {
  const store = createPreviewStore();
  store.snapshot.properties.push({ id: 'legacy-extra', name: '추가 미배정 숙소', organizationId: null, featureOverrides: {}, version: 1 });
  store.snapshot.users.find(item => item.id === 'preview-legacy-admin')!.propertyIds.push('legacy-extra');
  const api = createPreviewOperationsApi(store, 'super_admin'); const original = structuredClone(store);
  await assert.rejects(api('/api/admin/organizations/preview-company-a', command('PATCH', { version: 1, propertyIds: ['preview-anon', 'preview-unwadang', 'preview-legacy-property'], migrateAssignedUsers: true })), /모든 담당 지점/);
  assert.deepEqual(store, original);
});
test('preview admin invitations allow pending unassigned managers and active same-business staff only', async () => {
  const store = createPreviewStore(); const api = createPreviewOperationsApi(store, 'super_admin');
  await assert.rejects(api('/api/admin/organizations/preview-company-a/invite', command('POST', { email: 'legacy@example.invalid' })), /기존 계정/);
  store.snapshot.users.push({ id: 'pending', displayName: '가입 대기', email: 'pending@example.invalid', role: 'manager', status: 'pending_invite', organizationId: null, propertyIds: [], enabledModules: null, version: 1 });
  await api('/api/admin/organizations/preview-company-a/invite', command('POST', { email: 'pending@example.invalid' }));
  await api('/api/admin/organizations/preview-company-a/invite', command('POST', { email: 'manager@example.invalid' }));
  store.snapshot.users.find(item => item.id === 'preview-cleaner-a')!.status = 'suspended';
  await assert.rejects(api('/api/admin/organizations/preview-company-a/invite', command('POST', { email: 'cleaner@example.invalid' })), /기존 계정/);
});
