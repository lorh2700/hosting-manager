import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageTourOwner, tourOwnershipWhere, type TourActor } from '../lib/tour-access';
const manager: TourActor = { role: 'manager', session: { userId: 'manager' }, user: { organizationId: 'org1', enabledModules: ['tours'] } };

test('assigned tour menu permits all operations within the same business and denies another business', () => {
  assert.equal(canManageTourOwner(manager, { id: 'business-admin', organizationId: 'org1' }), true);
  assert.equal(canManageTourOwner(manager, { id: 'other', organizationId: 'org2' }), false);
  assert.equal(canManageTourOwner({ ...manager, role: 'admin' }, { id: 'other', organizationId: 'org2' }), false);
  assert.deepEqual(tourOwnershipWhere(manager), { owner: { organizationId: 'org1' } });
});

test('legacy ungrouped tour access remains owner-only and cleaners cannot acquire it', () => {
  const legacy = { ...manager, user: { organizationId: null, enabledModules: ['tours'] } };
  assert.equal(canManageTourOwner(legacy, { id: 'manager', organizationId: null }), true);
  assert.equal(canManageTourOwner(legacy, { id: 'other', organizationId: null }), false);
  assert.deepEqual(tourOwnershipWhere(legacy), { ownerId: 'manager' });
  assert.equal(canManageTourOwner({ ...manager, role: 'cleaner' }, { id: 'manager', organizationId: 'org1' }), false);
  assert.equal(canManageTourOwner({ ...manager, user: { ...manager.user, enabledModules: [] } }, { id: 'manager', organizationId: 'org1' }), false);
});

test('business option or status blocks tours even when the menu is granted; supervisor keeps global scope', () => {
  assert.equal(canManageTourOwner({ ...manager, organizationFeatures: { tours: false } }, { id: 'manager', organizationId: 'org1' }), false);
  assert.equal(canManageTourOwner({ ...manager, organizationStatus: 'inactive' }, { id: 'manager', organizationId: 'org1' }), false);
  assert.deepEqual(tourOwnershipWhere({ ...manager, role: 'super_admin' }), {});
  assert.equal(canManageTourOwner({ ...manager, role: 'super_admin' }, { id: 'other', organizationId: 'org2' }), true);
});
