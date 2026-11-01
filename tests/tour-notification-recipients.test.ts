import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getGuestStayTourNotificationRecipients, getTourNotificationRecipient } from '../lib/tour-notification-recipients';
import { db, resetDb } from './stubs/prisma';

const tour = { organizationId: 'org-a', owner: { organizationId: 'org-a', phone: '010-1111-2222', displayName: '기존 담당자', email: 'owner@example.com' } };
beforeEach(() => resetDb());

test('tour organization recipient overrides the owner and normalizes Korean international notation', async () => {
  db.tourNotificationSettings = [{ organizationId: 'org-a', phone: '+82 10-3333-4444' }, { organizationId: 'org-b', phone: '01099999999' }];
  assert.deepEqual(await getTourNotificationRecipient(tour), { name: '투어 담당자', phone: '01033334444' });
  assert.deepEqual(await getTourNotificationRecipient({ ...tour, owner: { ...tour.owner, organizationId: 'org-b' } }), { name: '투어 담당자', phone: '01033334444' });
});

test('legacy tours use their owner organization and only unconfigured settings fall back to the same owner', async () => {
  db.tourNotificationSettings = [{ organizationId: 'org-a', phone: '01033334444' }];
  assert.equal((await getTourNotificationRecipient({ ...tour, organizationId: null }))?.phone, '01033334444');
  db.tourNotificationSettings = [];
  assert.equal((await getTourNotificationRecipient(tour))?.phone, '01011112222');
  assert.equal((await getTourNotificationRecipient({ organizationId: null, owner: { ...tour.owner, organizationId: null } }))?.phone, '01011112222');
  db.tourNotificationSettings = [{ organizationId: 'org-a', phone: 'invalid 01033334444' }];
  assert.equal(await getTourNotificationRecipient(tour), null);
});

test('explicit tour organizations never fall back to another organization or an unscoped owner', async () => {
  db.tourNotificationSettings = [{ organizationId: 'org-b', phone: '01099999999' }];
  assert.equal(await getTourNotificationRecipient({ ...tour, owner: { ...tour.owner, organizationId: 'org-b' } }), null);
  assert.equal(await getTourNotificationRecipient({ ...tour, owner: { ...tour.owner, organizationId: null } }), null);
  assert.equal(await getTourNotificationRecipient({ ...tour, owner: { ...tour.owner, phone: null } }), null);
});

test('guest stay tours use only the property organization setting and preserve existing property recipients when unset', async () => {
  db.property = [{ id: 'p1', organizationId: 'org-a', owner: { organizationId: 'org-b' } }];
  db.tourNotificationSettings = [{ organizationId: 'org-a', phone: '01033334444' }, { organizationId: 'org-b', phone: '01099999999' }];
  db.inquiryNotificationSettings = [{ propertyId: 'p1', enabled: true, recipients: [{ name: '숙소 담당자', phone: '01055556666' }] }];
  assert.deepEqual(await getGuestStayTourNotificationRecipients('p1'), [{ name: '투어 담당자', phone: '01033334444' }]);
  db.tourNotificationSettings = [{ organizationId: 'org-b', phone: '01099999999' }];
  assert.deepEqual(await getGuestStayTourNotificationRecipients('p1'), [{ name: '숙소 담당자', phone: '01055556666' }]);
  assert.deepEqual(await getGuestStayTourNotificationRecipients('missing'), []);
  db.property[0].organizationId = null;
  assert.equal((await getGuestStayTourNotificationRecipients('p1'))[0].phone, '01099999999');
});
