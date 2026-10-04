import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, calls, resetDb, prisma, prismaOverrides } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, authState } from './stubs/auth';
import { GET as todayGET } from '../app/api/ops/today/route';
import { GET as eventsGET } from '../app/api/events/route';
import { POST as confirmCheckout } from '../app/api/checkout/confirm/route';
import { GET as calendarFeed } from '../app/c/[token]/ical.ics/route';
import { resolveCleanerLink } from '../lib/cleaner-link-access';
import { todayKst } from '../lib/dates';
import { canUseOpsModule, needsOpsCleaning, opsNextAction } from '../lib/ops-attention';
import { operationalDatabase } from '../lib/operational-database';
import { withAuth, ok, HttpError } from '../lib/core/http';
import { resolveAuditTarget } from '../lib/audit-target';
import { safeAuditDetails } from '../lib/audit-log';

const today = todayKst();
const context = { params: Promise.resolve({}) };
const req = (path: string, body?: unknown, method = 'POST') => new Request(`http://test${path}`, body === undefined ? {} :
  { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bodyOf = (response: Response) => (response as unknown as { body: any }).body;
beforeEach(() => {
  resetDb(); actAsManager(['p']);
  authState.auth.user.organizationId = 'org';
  authState.auth.organizationFeatures = {};
  db.organization = [{ id: 'org', status: 'active', features: {} }];
  db.property = [{ id: 'p', name: 'Stay', organizationId: 'org', featureOverrides: {} }];
  db.event = [{ id: 'e', propertyId: 'p', title: 'Guest', type: 'reservation', channelId: 'beds24',
    startDate: today, endDate: '2099-01-01', tags: [], guestEmail: 'private@test', guestPhone: 'private-phone', description: 'private-notes' }];
  db.message = [{ id: 'm', propertyId: 'p', eventId: 'e', type: 'message', sender: 'guest', text: 'private-message', read: false, createdAt: new Date() }];
});

test('today lazy conversation requires message grants and business option before reading guest data', async () => {
  authState.auth.user.enabledModules = ['reservations'];
  let response = await todayGET(req('/api/ops/today?view=conversation&eventId=e'), context);
  assert.equal(response.status, 403); assert.ok(!calls.includes('message.findMany'));
  authState.auth.user.enabledModules = ['reservations', 'messages'];
  authState.auth.organizationFeatures = { messages: false };
  response = await todayGET(req('/api/ops/today?view=conversation&eventId=e'), context);
  assert.equal(response.status, 403); assert.ok(!calls.includes('message.findMany'));
});

test('today lazy conversation also checks the target property option', async () => {
  db.property[0].featureOverrides = { messages: false };
  const response = await todayGET(req('/api/ops/today?view=conversation&eventId=e'), context);
  assert.equal(response.status, 403); assert.ok(!calls.includes('message.findMany'));
});

test('today cameras cannot inherit reservation permission or produce photo URLs when disabled', async () => {
  authState.auth.user.enabledModules = ['reservations'];
  const response = await todayGET(req('/api/ops/today?view=cameras'), context);
  assert.equal(response.status, 403); assert.ok(!calls.some(call => call.startsWith('cameraSnapshot.')));
});

test('a reservation-only board stays usable without fetching disabled optional modules', async () => {
  authState.auth.user.enabledModules = ['reservations'];
  const response = await todayGET(req('/api/ops/today?view=details'), context);
  assert.equal(response.status, 200);
  const data = bodyOf(response), property = data.properties[0], guest = property.checkins[0];
  assert.equal(guest.hasChat, false); assert.equal(guest.unread, 0); assert.deepEqual(guest.messages, []);
  assert.equal(property.readyMessage, ''); assert.equal(property.cleaning, null);
  assert.deepEqual(data.cleaners, []); assert.deepEqual(data.unavailable, []);
  assert.deepEqual(property.operationalModules, ['reservations']);
  assert.ok(!calls.some(call => /message\.|cleaning\.|cleaningApplication\.|cleaningIssue\.|supplyTodo\.|user\.findMany/.test(call)));
  assert.equal(canUseOpsModule(property, 'cleaning'), false);
  assert.equal(needsOpsCleaning({ ...property, checkouts: [guest] }), false);
});

test('today mixed-property options exclude messages, cleaning and optional counts only on disabled properties', async () => {
  authState.auth.propertyIds.push('off');
  db.property.push({ id: 'off', name: 'Off', organizationId: 'org', featureOverrides: { messages: false, cleaning: false, issues: false, supplies: false } });
  db.event.push({ ...db.event[0], id: 'off-e', propertyId: 'off' });
  db.message.push({ ...db.message[0], id: 'off-m', eventId: 'off-e', propertyId: 'off', text: 'never-return' });
  db.cleaning = [{ id: 'off-c', propertyId: 'off', date: today, status: 'pending', cleanerId: null, notes: 'never-return' }];
  db.cleaningIssue = [{ id: 'off-i', propertyId: 'off', status: 'open' }];
  db.supplyTodo = [{ id: 'off-s', propertyId: 'off', done: false }];
  const response = await todayGET(req('/api/ops/today?view=details'), context);
  const data = bodyOf(response), off = data.properties.find((p: any) => p.id === 'off');
  assert.equal(response.status, 200); assert.equal(off.cleaning, null); assert.equal(off.checkins[0].hasChat, false);
  assert.equal(JSON.stringify(data).includes('never-return'), false);
  assert.equal(data.counts.openIssues, 0); assert.equal(data.counts.pendingSupplies, 0);
  assert.equal(data.properties.find((p: any) => p.id === 'p').checkins[0].messages[0].text, 'private-message');
});

test('disabled cleaning property cannot contribute assignee details to the lazy board', async () => {
  db.property[0].featureOverrides = { cleaning: false };
  const response = await todayGET(req('/api/ops/today?view=assignees'), context);
  assert.equal(response.status, 200); assert.deepEqual(bodyOf(response).cleaners, []);
  assert.ok(!calls.includes('user.findMany'));
});

test('cleaning date access omits guest contacts and internal booking notes for cleaners and cleaning-only managers', async () => {
  for (const role of ['manager', 'cleaner']) {
    if (role === 'cleaner') { actAsCleaner(['p']); authState.auth.user.organizationId = 'org'; authState.auth.propertyIds = ['p']; }
    authState.auth.user.enabledModules = ['cleaning'];
    const response = await eventsGET(req('/api/events'), context);
    assert.equal(response.status, 200);
    const event = bodyOf(response)[0];
    assert.equal(event.startDate, today); assert.equal(event.title, 'Guest');
    assert.equal(event.guestEmail, undefined); assert.equal(event.guestPhone, undefined); assert.equal(event.description, undefined);
  }
});

test('disabling business reservations preserves cleaning dates but cannot expose reservation contacts', async () => {
  authState.auth.organizationFeatures = { reservations: false };
  const response = await eventsGET(req('/api/events'), context);
  assert.equal(response.status, 200);
  assert.equal(bodyOf(response)[0].startDate, today);
  assert.equal(bodyOf(response)[0].guestEmail, undefined);
});

test('disabled provider and room services keep local reservations visible without send, maintenance or camera reads', async () => {
  db.property[0].featureOverrides = { integrations: false, guestServices: false };
  const response = await todayGET(req('/api/ops/today?view=board'), context);
  const property = bodyOf(response).properties[0];
  assert.equal(response.status, 200); assert.equal(property.checkins.length, 1);
  assert.equal(property.canSendMessages, false); assert.equal(property.canCreateMaintenance, false);
  calls.length = 0;
  const cameras = await todayGET(req('/api/ops/today?view=cameras'), context);
  assert.equal(cameras.status, 200); assert.deepEqual(bodyOf(cameras).properties, []);
  assert.ok(!calls.some(call => call.startsWith('cameraSnapshot.')));
});

test('checkout confirmation belongs to reservation operations and does not require payment permission', async () => {
  authState.auth.user.enabledModules = ['reservations', 'cleaning'];
  authState.auth.organizationFeatures = { payments: false };
  const response = await confirmCheckout(req('/api/checkout/confirm', { propertyId: 'p', date: today }), context);
  assert.equal(response.status, 200); assert.equal(db.checkoutSignal.length, 1);
});

function seedLink(status = 'no_account') {
  db.user = [{ id: 'staff', displayName: 'Staff', role: 'cleaner', status, organizationId: 'org', publicToken: 'private-link', enabledModules: ['cleaning'] }];
  db.userProperty = [{ userId: 'staff', propertyId: 'p' }, { userId: 'staff', propertyId: 'foreign' }];
  db.organization.push({ id: 'foreign-org', status: 'active', features: {} });
  db.property.push({ id: 'foreign', name: 'Foreign Business', organizationId: 'foreign-org' });
  db.cleaning = [{ id: 'own', propertyId: 'p', cleanerId: 'staff', date: today, status: 'pending' },
    { id: 'foreign-c', propertyId: 'foreign', cleanerId: 'staff', date: today, status: 'pending', notes: 'foreign-secret' }];
}
test('no-account employee links remain usable while stale cross-business assignments are removed', async () => {
  seedLink();
  assert.deepEqual((await resolveCleanerLink('private-link'))?.propertyIds, ['p']);
  const response = await calendarFeed(req('/c/private-link/ical.ics'), { params: Promise.resolve({ token: 'private-link' }) });
  const text = await response.text();
  assert.equal(response.status, 200); assert.ok(text.includes('Stay')); assert.ok(!text.includes('foreign-secret'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('public cleaner calendars revoke suspended accounts, inactive businesses and disabled cleaning grants', async () => {
  seedLink('suspended'); assert.equal(await resolveCleanerLink('private-link'), null);
  db.user[0].status = 'no_account'; db.organization[0].status = 'inactive';
  assert.equal(await resolveCleanerLink('private-link'), null);
  db.organization[0].status = 'active'; db.user[0].enabledModules = [];
  assert.equal(await resolveCleanerLink('private-link'), null);
  db.user[0].enabledModules = ['cleaning']; db.organization[0].features = { cleaning: false };
  assert.equal(await resolveCleanerLink('private-link'), null);
});

test('cleaner feed excludes properties disabled after issuing the token or removed from current assignments', async () => {
  seedLink(); db.property[0].featureOverrides = { cleaning: false };
  assert.deepEqual((await resolveCleanerLink('private-link'))?.propertyIds, []);
  db.property[0].featureOverrides = {}; db.userProperty = [];
  const response = await calendarFeed(req('/c/private-link/ical.ics'), { params: Promise.resolve({ token: 'private-link' }) });
  assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('BEGIN:VEVENT'));
});

test('supervisor operations on supply requests, issues and messages retain the target business audit scope', async () => {
  actAsAdmin();
  for (const [resource, model] of [['supply-requests', 'supplyRequest'], ['cleaning-issues', 'cleaningIssue'], ['messages', 'message']]) {
    db[model] = [{ id: `${resource}-id`, propertyId: 'p', text: 'private-content' }];
    const handler = withAuth(resource, async () => ok({ ok: true }));
    const response = await handler(req(`/api/${resource}`, { id: `${resource}-id` }, 'PUT'), context);
    assert.equal(response.status, 200);
    const audit = db.auditLog.at(-1)!;
    assert.equal(audit.organizationId, 'org'); assert.equal(audit.propertyId, 'p');
    assert.equal(JSON.stringify(audit).includes('private-content'), false);
  }
});

test('tour activity resolves a business through the owner rather than the supervisor actor', async () => {
  db.user = [{ id: 'owner', organizationId: 'org' }];
  db.tour = [{ id: 'tour', ownerId: 'owner' }];
  db.tourBooking = [{ id: 'tour-booking', tourId: 'tour' }];
  assert.deepEqual(await resolveAuditTarget('tours', 'tour'), { organizationId: 'org' });
  assert.deepEqual(await resolveAuditTarget('tour-bookings/forward', 'tour-booking'), { organizationId: 'org' });
});

test('bulk message status changes appear in every affected business without copying message content', async () => {
  actAsAdmin();
  db.property.push({ id: 'other-p', organizationId: 'other-org' });
  db.message.push({ id: 'other-m', propertyId: 'other-p', text: 'other-private-content' });
  const handler = withAuth('messages', async () => ok({ updated: true }));
  const response = await handler(req('/api/messages', { ids: ['m', 'other-m'], read: true }, 'PUT'), context);
  assert.equal(response.status, 200);
  assert.deepEqual(db.auditLog.map(log => log.organizationId).sort(), ['org', 'other-org']);
  assert.equal(JSON.stringify(db.auditLog).includes('other-private-content'), false);
});

test('bulk message auditing does not attribute a scoped operation to an unassigned business', async () => {
  db.property.push({ id: 'other-p', organizationId: 'other-org' });
  db.message.push({ id: 'other-m', propertyId: 'other-p' });
  const handler = withAuth('messages', async () => ok({ updated: true }));
  const response = await handler(req('/api/messages', { ids: ['m', 'other-m'], read: true }, 'PUT'), context);
  assert.equal(response.status, 200);
  assert.deepEqual(db.auditLog.map(log => log.organizationId), ['org']);
});

test('permission activity never records an invitation credential or URL query secret', () => {
  const details = safeAuditDetails({ method: 'DELETE', path: '/api/invitations/private-invitation-token/renew?token=private-query-secret' });
  assert.equal(details.path, '/api/invitations/[token]/renew');
  assert.equal(JSON.stringify(details).includes('private-'), false);
});

test('missing access schema produces a safe migration notice and unrelated failures remain failures', async () => {
  for (const code of ['P2021', 'P2022']) await assert.rejects(operationalDatabase(async () => { throw Object.assign(new Error('raw-database-secret'), { code }); }),
    (error: unknown) => error instanceof HttpError && error.status === 503 && error.extra?.migrationRequired === true && !error.message.includes('secret'));
  const unrelated = new Error('connection outage');
  await assert.rejects(operationalDatabase(async () => { throw unrelated; }), error => error === unrelated);
});

test('real session authorization returns a migration notice before any handler on an old schema', async () => {
  // lib/auth uses a relative Prisma import. Seed its global singleton BEFORE
  // loading it, so even this real JWT/session path cannot construct a DB pool.
  (globalThis as unknown as { prisma: unknown }).prisma = prisma;
  const { getSessionWithUser, signToken } = await import('../lib/auth');
  const token = await signToken({ userId: 'migration-user', email: 'sample@test' });
  for (const code of ['P2021', 'P2022']) {
    prismaOverrides.user = { findUnique: async () => { throw Object.assign(new Error('raw-column-details'), { code }); } };
    await assert.rejects(getSessionWithUser(new Request('http://test/api/ops/today', { headers: { authorization: `Bearer ${token}` } })),
      (error: unknown) => error instanceof HttpError && error.status === 503 && error.extra?.migrationRequired === true);
  }
});

test('a disabled cleaning option removes assignment recommendations and a disabled provider removes send recommendations', () => {
  const property: any = { hasWork: true, operationalModules: ['reservations', 'messages'], checkouts: [], checkins: [{ id: 'e', hasChat: true }], cleaning: null, canSendMessages: false };
  assert.equal(opsNextAction(property, true), null);
  assert.equal(needsOpsCleaning({ ...property, checkouts: [{}] }), false);
});
