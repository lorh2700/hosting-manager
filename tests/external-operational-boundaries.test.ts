import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prisma, db, resetDb, prismaOverrides, calls } from './stubs/prisma';
import { actAsAdmin } from './stubs/auth';
import { resetNotify, notifyCalls } from './stubs/notify';
import { callRoute, resetFetch, setFetchHandler, fetchLog, json } from './helpers/beds24-mock';
import { authenticateApiRequest, generateApiKey, propertyScopeFilter } from '../lib/api-auth';
import { GET as CLEANINGS, POST as CREATE } from '../app/api/v1/cleanings/route';
import { GET as CLEANING, PATCH, DELETE } from '../app/api/v1/cleanings/[id]/route';
import { GET as PROPERTIES } from '../app/api/v1/properties/route';
import { GET as BOOKINGS } from '../app/api/v1/bookings/route';
import { GET as AVAILABILITY } from '../app/api/v1/properties/[id]/availability/route';
import { POST as SYNC } from '../app/api/sync/route';
import { syncICalChannel } from '../lib/sync-engine';
import { GET as PAD_GET, POST as PAD_POST } from '../app/api/public/welcomepad/checkout/route';
import { GET as CALENDAR } from '../app/api/public/stay-calendar/route';
import { priceStay } from '../lib/payments/checkout';
import { todayKst, addDaysToDateStr } from '../lib/dates';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const key = 'vd_live_aaaaaaaaaaaaaa_-aaaaaaaaaaaaaaaa';
const keyHash = (value: string) => createHash('sha256').update(value).digest('hex');
const date = addDaysToDateStr(todayKst(), 1);
const next = addDaysToDateStr(todayKst(), 2);
const cleaningMethods = prisma.cleaning;

function client(over: Record<string, unknown> = {}) {
  return { id: 'client-a', name: 'Stayfolio A', keyHash: keyHash(key), keyPrefix: key.slice(0, 16),
    scopes: ['properties:read', 'bookings:read', 'cleanings:read', 'cleanings:write'], propertyIds: [P1],
    lastUsedAt: new Date(), revokedAt: null, expiresAt: null, ...over };
}
function cleaning(over: Record<string, unknown> = {}) {
  return { id: 'cleaning-a', propertyId: P1, externalSource: 'api-client:client-a', externalId: 'same-id', date,
    cleanerId: null, externalCleanerName: null, externalCleanerPhone: null, status: 'pending', origin: 'external',
    supplies: null, notes: null, completionNote: null, completedAt: null, hasIssue: false, createdAt: new Date(), ...over };
}
const request = (path: string, method = 'GET', body?: unknown, token = key) => new Request(`http://localhost${path}`, {
  method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const create = (body: Record<string, unknown> = {}) => callRoute(CREATE, request('/api/v1/cleanings', 'POST', { propertyId: P1, externalId: 'same-id', date, ...body }));
const invokeId = async (handler: any, req: Request, id: string): Promise<{ status: number; body: any }> => handler(req, { params: Promise.resolve({ id }) });
const mutate = (handler: typeof PATCH | typeof DELETE, method: string, id = 'cleaning-a', body?: unknown) => invokeId(handler, request(`/api/v1/cleanings/${id}`, method, body), id);

beforeEach(() => {
  resetDb(); resetFetch(); resetNotify(); actAsAdmin();
  process.env.WELCOMEPAD_API_KEY = 'isolated-pad-key';
  process.env.CHECKOUT_BEDS24_OFFER_ID = '1';
  db.organization = [{ id: 'org-a', status: 'active', features: {} }, { id: 'org-b', status: 'active', features: {} }, { id: 'org-off', status: 'inactive', features: {} }];
  db.property = [P1, P2, P3].map((id, index) => ({ id, name: `Property ${index + 1}`, organizationId: ['org-a', 'org-b', 'org-off'][index],
    status: 'active', featureOverrides: {}, beds24RoomId: String(index + 1), beds24PropId: String(index + 10), maxGuests: 6, welcomepadKey: `pad-${index + 1}` }));
  db.apiClient = [client()]; db.cleaning = [];
  // Model defaults only; the real route and business predicates remain in use.
  prismaOverrides.cleaning = { ...cleaningMethods, create: async (args: any) => cleaningMethods.create({ ...args,
    data: { createdAt: new Date(), hasIssue: false, completionNote: null, ...args.data } }) };
  setFetchHandler(() => { throw new Error('Unexpected remote operation'); });
});

test('every generated base64url API key authenticates, including underscore and hyphen', async () => {
  assert.equal((await authenticateApiRequest(request('/api/v1/cleanings'), { scope: 'cleanings:read' })).ok, true);
  for (let index = 0; index < 25; index++) {
    const generated = generateApiKey(index % 2 ? 'live' : 'test');
    db.apiClient = [client({ keyHash: generated.hash, keyPrefix: generated.prefix })];
    assert.equal((await authenticateApiRequest(request('/api/v1/cleanings', 'GET', undefined, generated.plain), { scope: 'cleanings:read' })).ok, true);
  }
});

test('revoked, expired and wrong-scope keys fail without reading operational data', async () => {
  for (const [changes, kind] of [[{ revokedAt: new Date() }, 'revoked'], [{ expiresAt: new Date(0) }, 'expired'], [{ scopes: [] }, 'forbidden_scope']] as const) {
    db.apiClient = [client(changes)]; calls.length = 0;
    const result = await authenticateApiRequest(request('/api/v1/cleanings'), { scope: 'cleanings:read' });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.kind, kind);
    assert.ok(!calls.includes('property.findMany'));
  }
  assert.equal((await callRoute(CLEANINGS, request('/api/v1/cleanings', 'GET', undefined, 'bad-key'))).status, 401);
});

test('global legacy key resolves enabled properties, and an empty resolved scope never becomes a wildcard', async () => {
  db.apiClient[0].propertyIds = [];
  db.property[1].featureOverrides = { cleaning: false };
  const cleaningScope = await authenticateApiRequest(request('/api/v1/cleanings'), { scope: 'cleanings:read' });
  assert.ok(cleaningScope.ok); if (cleaningScope.ok) assert.deepEqual(cleaningScope.client.propertyIds, [P1]);
  const bookingScope = await authenticateApiRequest(request('/api/v1/bookings'), { scope: 'bookings:read' });
  assert.ok(bookingScope.ok); if (bookingScope.ok) assert.deepEqual(bookingScope.client.propertyIds, [P1, P2]);
  db.organization[0].status = 'inactive'; db.organization[1].status = 'inactive';
  db.cleaning = [cleaning({ notes: 'must not be exposed' })];
  assert.deepEqual(propertyScopeFilter({ ...client(), propertyIds: [] }), { propertyId: { in: [] } });
  assert.deepEqual((await callRoute(CLEANINGS, request('/api/v1/cleanings'))).body.items, []);
  assert.deepEqual((await callRoute(PROPERTIES, request('/api/v1/properties'))).body.properties, []);
  assert.deepEqual((await callRoute(BOOKINGS, request('/api/v1/bookings'))).body.items, []);
  assert.equal((await create()).status, 403);
  assert.equal((await invokeId(AVAILABILITY, request(`/api/v1/properties/${P1}/availability?from=${date}&to=${next}`), P1)).status, 403);
});

test('restricted external clients cannot read or create a cleaning in another property', async () => {
  db.cleaning = [cleaning({ propertyId: P2 })];
  assert.equal((await create({ propertyId: P2 })).status, 403);
  assert.equal((await invokeId(CLEANING, request('/api/v1/cleanings/cleaning-a'), 'cleaning-a')).status, 404);
  assert.equal(db.cleaning[0].propertyId, P2); assert.equal((db.auditLog || []).length, 0);
});

test('clients with the same name prefix use distinct namespaces and cannot overwrite a foreign legacy record', async () => {
  db.apiClient.push(client({ id: 'client-b', name: 'Stayfolio B', keyHash: 'different-hash', propertyIds: [P2] }));
  db.cleaning = [cleaning({ id: 'foreign', propertyId: P2, externalSource: 'stayfolio', notes: 'other business original' })];
  const created = await create({ notes: 'our new record' });
  assert.equal(created.status, 201); assert.equal(created.body.externalSource, 'api-client:client-a');
  assert.equal(db.cleaning.find(row => row.id === 'foreign')!.notes, 'other business original');
  assert.equal(db.cleaning.length, 2); assert.equal(db.auditLog[0].organizationId, 'org-a');
});

test('idempotent POST updates one owned record but cannot move its external ID to another property', async () => {
  db.apiClient[0].propertyIds = [P1, P2];
  assert.equal((await create()).status, 201);
  const replay = await create({ status: 'done', notes: 'updated' });
  assert.equal(replay.status, 200); assert.equal(db.cleaning.length, 1); assert.ok(db.cleaning[0].completedAt instanceof Date);
  assert.equal((await create({ propertyId: P2 })).status, 409);
  assert.equal(db.cleaning[0].propertyId, P1); assert.equal(db.cleaning[0].notes, 'updated');
  assert.equal(db.auditLog.length, 2);
});

test('changing an existing cleaning date cannot take an already occupied slot', async () => {
  db.cleaning = [cleaning(), cleaning({ id: 'another', externalId: 'another', date: next })];
  const result = await create({ date: next });
  assert.equal(result.status, 409); assert.equal(result.body.code, 'slot_already_claimed');
  assert.equal(db.cleaning[0].date, date); assert.equal((db.auditLog || []).length, 0);
});

test('an unambiguous legacy client keeps its existing record and source label', async () => {
  db.cleaning = [cleaning({ externalSource: 'stayfolio' })];
  const replay = await create({ notes: 'compatible legacy replay' });
  assert.equal(replay.status, 200); assert.equal(db.cleaning.length, 1);
  assert.equal(db.cleaning[0].externalSource, 'stayfolio'); assert.equal(db.cleaning[0].notes, 'compatible legacy replay');
});

test('ambiguous legacy ownership cannot be adopted by POST, PATCH or DELETE', async () => {
  db.apiClient.push(client({ id: 'client-b', name: 'Stayfolio B', keyHash: 'different-hash', propertyIds: [P1], revokedAt: new Date() }));
  db.cleaning = [cleaning({ externalSource: 'stayfolio', notes: 'original' })];
  assert.equal((await create({ notes: 'overwrite' })).status, 409);
  assert.equal((await mutate(PATCH, 'PATCH', 'cleaning-a', { notes: 'overwrite' })).status, 403);
  assert.equal((await mutate(DELETE, 'DELETE')).status, 403);
  assert.equal(db.cleaning.length, 1); assert.equal(db.cleaning[0].notes, 'original');
});

test('PATCH and DELETE enforce client namespace even when both keys can access the same property', async () => {
  db.cleaning = [cleaning({ externalSource: 'api-client:client-b', notes: 'original' })];
  assert.equal((await mutate(PATCH, 'PATCH', 'cleaning-a', { notes: 'overwrite' })).status, 403);
  assert.equal((await mutate(DELETE, 'DELETE')).status, 403);
  assert.equal(db.cleaning[0].notes, 'original');
  db.cleaning[0].externalSource = 'api-client:client-a';
  assert.equal((await mutate(PATCH, 'PATCH', 'cleaning-a', { status: 'done' })).status, 200);
  assert.equal((await mutate(DELETE, 'DELETE')).status, 200);
  assert.equal(db.cleaning.length, 0); assert.equal(db.auditLog.length, 2);
});

test('external cleaning and its audit record commit together, and audit errors roll back the cleaning', async () => {
  prismaOverrides.auditLog = { create: async () => { throw new Error('synthetic audit failure'); } };
  assert.equal((await create()).status, 500); assert.equal(db.cleaning.length, 0);
  db.cleaning = [cleaning({ notes: 'retained original' })];
  assert.equal((await mutate(PATCH, 'PATCH', 'cleaning-a', { notes: 'must roll back' })).status, 500);
  assert.equal(db.cleaning[0].notes, 'retained original');
  assert.equal((await mutate(DELETE, 'DELETE')).status, 500); assert.equal(db.cleaning.length, 1);
});

test('simultaneous idempotent pushes keep one record, and competing clients cannot claim the same property/date slot', async () => {
  const replay = await Promise.all([create(), create({ notes: 'retry' })]);
  assert.deepEqual(replay.map(result => result.status).sort(), [200, 201]); assert.equal(db.cleaning.length, 1);
  db.cleaning = []; db.auditLog = [];
  const secondKey = `vd_live_${'b'.repeat(32)}`;
  db.apiClient.push(client({ id: 'client-b', name: 'Different Partner', keyHash: keyHash(secondKey), propertyIds: [P1] }));
  const competition = await Promise.all([create(), callRoute(CREATE, request('/api/v1/cleanings', 'POST', { propertyId: P1, date, externalId: 'other-id' }, secondKey))]);
  assert.deepEqual(competition.map(result => result.status).sort(), [201, 409]);
  assert.equal(db.cleaning.length, 1); assert.equal(db.auditLog.length, 1);
});

test('business feature denial wins over property overrides for external read and write', async () => {
  db.organization[0].features = { integrations: false }; db.property[0].featureOverrides = { integrations: true };
  db.cleaning = [cleaning()];
  assert.deepEqual((await callRoute(CLEANINGS, request('/api/v1/cleanings'))).body.items, []);
  assert.equal((await create()).status, 403); assert.equal(db.cleaning.length, 1);
  db.organization[0].features = { reservations: false };
  assert.equal((await invokeId(AVAILABILITY, request(`/api/v1/properties/${P1}/availability?from=${date}&to=${next}`), P1)).status, 403);
});

test('disabled iCal integration stops before fetch and preserves existing events', async () => {
  db.event = [{ id: 'retained', propertyId: P1, channelId: 'old', originalUid: 'r1', startDate: date, endDate: next }];
  for (const changes of [{ status: 'inactive', features: {} }, { status: 'active', features: { integrations: false } }]) {
    Object.assign(db.organization[0], changes);
    const result = await syncICalChannel(P1, 'old', 'https://www.beds24.com/ical/bookings.ics', 'beds24');
    assert.match(result.error || '', /연동 옵션/); assert.equal(fetchLog.length, 0); assert.equal(db.event[0].id, 'retained');
  }
  db.organization[0].status = 'active'; db.organization[0].features = {};
  setFetchHandler(() => json('BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
  await syncICalChannel(P1, 'old', 'https://www.beds24.com/ical/bookings.ics', 'beds24');
  assert.equal(fetchLog.length, 1);
});

test('single and batch sync skip disabled properties before integration reads or writes', async () => {
  db.property = [db.property[2]];
  assert.equal((await callRoute(SYNC, request('/api/sync', 'POST', { propertyId: P3 }))).status, 403);
  assert.ok(!calls.includes('integration.findMany')); assert.equal(fetchLog.length, 0);
  const batch = await callRoute(SYNC, request('/api/sync', 'POST', {}));
  assert.equal(batch.status, 200); assert.equal(batch.body.summary.propertiesSynced, 0);
  assert.equal(batch.body.summary.channelsSynced, 0); assert.equal(fetchLog.length, 0);
});

test('disabled guest services block pad checkout status, writes and notifications', async () => {
  for (const changes of [{ status: 'inactive', features: {} }, { status: 'active', features: { guestServices: false } }]) {
    Object.assign(db.organization[0], changes);
    const headers = { 'x-api-key': 'isolated-pad-key', 'content-type': 'application/json' };
    assert.equal((await callRoute(PAD_GET, new Request('http://localhost/api/public/welcomepad/checkout?propertyKey=pad-1', { headers }))).status, 403);
    assert.equal((await callRoute(PAD_POST, new Request('http://localhost/api/public/welcomepad/checkout', { method: 'POST', headers, body: JSON.stringify({ propertyKey: 'pad-1' }) }))).status, 403);
    assert.equal((db.checkoutSignal || []).length, 0); assert.equal(notifyCalls.checkout.length, 0);
  }
});

test('public price and calendar consistently stop before Beds24 when the business or reservation/integration option is disabled', async () => {
  for (const changes of [{ status: 'inactive', features: {} }, { status: 'active', features: { reservations: false } }, { status: 'active', features: { integrations: false } }]) {
    Object.assign(db.organization[0], changes); db.property[0].featureOverrides = { reservations: true, integrations: true };
    await assert.rejects(priceStay({ propertyId: P1, checkIn: date, checkOut: next, guests: 2 }), (error: any) => error.status === 403 && error.extra?.code === 'service_disabled');
    const result = await callRoute(CALENDAR, new Request(`http://localhost/api/public/stay-calendar?propertyId=${P1}&start=${date}&end=${next}`));
    assert.equal(result.status, 403); assert.equal(result.body.code, 'service_disabled'); assert.equal(fetchLog.length, 0);
  }
});
