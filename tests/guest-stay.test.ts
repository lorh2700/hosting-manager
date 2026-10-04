import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { guestStayPhase, guestStayRequestSchema, guestStayDateSchema, requestDateWithinStay } from '../lib/guest-stay';
import { guestStayHash, guestStayCsrf, requireStayCsrf, requireStayOrigin, requireGuestStay, loginGuestStay, liveStay,
  createGuestStayRequest, guestStayRequests, issueGuestStayAccess, requireStayDevice, currentDeviceStay, newStayToken,
  normalizeStayCode, throttleStayAttempt, readStayJson, deviceStayProof, requireDeviceStayProof } from '../lib/guest-stay-store';
import { sealInvitation } from '../lib/guest-invitation-token';
import { todayKst, addDaysToDateStr } from '../lib/dates';
import { db, resetDb, prisma, prismaOverrides, matches } from './stubs/prisma';
import { actAsAdmin, actAsManager } from './stubs/auth';
import { GET as adminGet } from '../app/api/guest-stays/route';
import { POST as pairDevice } from '../app/api/public/guest-stay/device/pair/route';
import { PATCH as updateRequest } from '../app/api/guest-stays/requests/[id]/route';
import { POST as issueAccess } from '../app/api/guest-stays/access/route';
import type { StubResponse } from './stubs/next-server';

const propertyId = 'legacy_property_id', otherProperty = 'other_property', id = '8b17a1d0-900a-400a-800a-23d02b2a4ee0';
const today = todayKst(), yesterday = addDaysToDateStr(today, -1), tomorrow = addDaysToDateStr(today, 1);
const ref = { kind: 'booking' as const, id, propertyId };
const buckets = new Map<string, number>();
function req(path = '/api/public/guest-stay/login', body?: unknown, token?: string) {
  return new Request(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(token ? { Cookie: `va_guest_stay=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function installModelDefaults(name: string) {
  const base = prisma[name];
  prismaOverrides[name] = { ...base,
    create: (args: Record<string, any>) => base.create({ ...args, data: { createdAt: new Date(), updatedAt: new Date(), version: 1,
      revokedAt: null, status: 'requested', publicReply: '', internalNote: '', ...args.data } }),
    upsert: async (args: Record<string, any>) => {
      const row = (db[name] || []).find(item => matches(item, args.where));
      if (row) {
        for (const [key, value] of Object.entries(args.update)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + (value as { increment: number }).increment : value;
        return { ...row };
      }
      return base.create({ data: { createdAt: new Date(), revokedAt: null, ...args.create } });
    },
    updateMany: async (args: Record<string, any>) => {
      const rows = (db[name] || []).filter(row => matches(row, args.where));
      for (const row of rows) for (const [key, value] of Object.entries(args.data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + (value as { increment: number }).increment : value;
      return { count: rows.length };
    },
  };
}
beforeEach(() => {
  resetDb(); buckets.clear(); actAsAdmin();
  db.property = [{ id: propertyId, slug: 'anon', name: '안온재', status: 'active' }, { id: otherProperty, slug: 'unwadang', name: '운와당', status: 'active' }];
  db.booking = [{ id, propertyId, name: 'Test Guest', checkIn: yesterday, checkOut: tomorrow, guests: 2, status: 'confirmed' }];
  for (const name of ['guestStayAccess', 'guestStaySession', 'guestStayRequest', 'guestStayAttempt', 'guestStayDevice']) installModelDefaults(name);
  const sessionBase = prisma.guestStaySession;
  prismaOverrides.guestStaySession = { ...sessionBase, findUnique: async (args: Record<string, any>) => {
    const row = await sessionBase.findUnique(args);
    return row ? { ...row, access: db.guestStayAccess.find(access => access.id === row.accessId) } : null;
  } };
  prismaOverrides.$queryRaw = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const key = String(values[0]), count = (buckets.get(key) || 0) + 1; buckets.set(key, count); return [{ count }];
  };
  prismaOverrides.$executeRaw = async () => 0;
});
async function credential() { return issueGuestStayAccess((await liveStay(ref))!, 'staff'); }
async function loggedIn() {
  const grant = await credential();
  return loginGuestStay(req(), { slug: 'anon', name: 'Test Guest', code: grant.code });
}

test('disabling guest services revokes live fixed QR access and blocks a form opened before the option changed', async () => {
  const session = await loggedIn();
  db.property[0].featureOverrides = { guestServices: false };
  assert.equal(await liveStay(ref), null);
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, session.token)), /変更|변경/);
  await assert.rejects(createGuestStayRequest(session.stay, { id: randomUUID(), kind: 'help', details: { category: 'supplies', message: 'Towels' } }, 'mobile'), /해당 서비스를/);
  assert.equal((db.guestStayRequest ?? []).length, 0);
});

test('a supervisor disabled tour option cannot be enabled by a property override or direct guest request', async () => {
  const stay = (await liveStay(ref))!;
  db.property[0].organization = { status: 'active', features: { tours: false } };
  db.property[0].featureOverrides = { tours: true };
  await assert.rejects(createGuestStayRequest(stay, { id: randomUUID(), kind: 'tour', details: { tourId: randomUUID(), date: tomorrow, time: '09:00', guests: 1 } }, 'mobile'), /해당 서비스를/);
  assert.equal((db.guestStayRequest ?? []).length, 0);
});

test('KST turnover has a closed interval between checkout 11:00 and next check-in 15:00', () => {
  const before = Date.parse('2026-10-02T10:59:59+09:00'), out = Date.parse('2026-10-02T11:00:00+09:00'), enter = Date.parse('2026-10-02T15:00:00+09:00');
  assert.equal(guestStayPhase('2026-10-01', '2026-10-02', before), 'staying');
  assert.equal(guestStayPhase('2026-10-01', '2026-10-02', out), null);
  assert.equal(guestStayPhase('2026-10-02', '2026-10-03', out), 'before_arrival');
  assert.equal(guestStayPhase('2026-10-02', '2026-10-03', enter), 'staying');
});
test('real dates and strict request variants reject nonexistent dates, arbitrary booking scope and hidden credentials', () => {
  assert.equal(guestStayDateSchema.safeParse('2026-02-30').success, false);
  assert.equal(guestStayRequestSchema.safeParse({ id: randomUUID(), kind: 'help', details: { category: 'issue', message: 'Need help' }, reservationId: 'foreign' }).success, false);
  assert.equal(guestStayRequestSchema.safeParse({ id: randomUUID(), kind: 'taxi', details: { date: '2026-10-02', time: '25:00', destination: 'Station', passengers: 2, luggage: 0 } }).success, false);
});
test('taxi can be requested for exact checkout time but a tour starts before checkout', () => {
  const value = { date: '2026-10-02', time: '11:00' }, stay = { checkIn: '2026-10-01', checkOut: '2026-10-02' }, now = Date.parse('2026-10-02T09:00:00+09:00');
  assert.equal(requestDateWithinStay(value, stay, now), false);
  assert.equal(requestDateWithinStay(value, stay, now, '11:00', true), true);
});
test('Origin and session-bound CSRF reject cross-site writes and another guest token', () => {
  const token = newStayToken();
  assert.throws(() => requireStayOrigin(new Request('http://localhost/api', { headers: { Origin: 'https://evil.test' } })), /다시 시도/);
  assert.throws(() => requireStayOrigin(new Request('http://localhost/api')), /다시 시도/);
  assert.throws(() => requireStayCsrf(req(), token, { csrfToken: guestStayCsrf(newStayToken()) }), /새로고침/);
  assert.doesNotThrow(() => requireStayCsrf(req(), token, { csrfToken: guestStayCsrf(token) }));
});
test('successful fixed QR login requires exact normalized full name and only stores token/code hashes', async () => {
  const grant = await credential();
  await assert.rejects(loginGuestStay(req(), { slug: 'anon', name: 'Guest', code: grant.code }), /이용 정보를/);
  const result = await loginGuestStay(req(), { slug: 'anon', name: 'Ｔｅｓｔ　Ｇｕｅｓｔ', code: grant.code });
  assert.equal(result.stay.id, id); assert.equal(result.stay.phase, 'staying');
  assert.equal(db.guestStaySession[0].tokenHash, guestStayHash(result.token));
  assert.equal(JSON.stringify(db.guestStayAccess).includes(normalizeStayCode(grant.code)), false);
  assert.equal(JSON.stringify(db.guestStaySession).includes(result.token), false);
});
test('future fixed QR code is denied while a private reservation link supports planning', async () => {
  db.booking[0].checkIn = addDaysToDateStr(today, 2); db.booking[0].checkOut = addDaysToDateStr(today, 4);
  const grant = await credential();
  await assert.rejects(loginGuestStay(req(), { slug: 'anon', name: 'Test Guest', code: grant.code }), /이용 정보를/);
  const token = new URL(grant.privatePath, 'http://localhost').searchParams.get('accessToken')!;
  const result = await loginGuestStay(req(), { slug: 'anon', name: 'Test Guest', accessToken: token });
  assert.equal(result.stay.phase, 'before_arrival');
  await assert.rejects(createGuestStayRequest(result.stay, { id: randomUUID(), kind: 'help', details: { category: 'supplies', message: 'Towels' } }, 'mobile'), /체크인 후/);
});
test('existing encrypted invitation validates live reservation, property and name', async () => {
  const invitation = sealInvitation({ ...ref, expires: Date.now() + 3600000 }, process.env.JWT_SECRET!);
  await assert.rejects(loginGuestStay(req(), { slug: 'unwadang', name: 'Test Guest', invitation }), /이용 정보를/);
  const result = await loginGuestStay(req(), { slug: 'anon', name: 'Test Guest', invitation });
  assert.equal(result.stay.propertyId, propertyId);
  db.booking[0].status = 'cancelled';
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, result.token)), /예약 정보가 변경/);
});
test('live name/date changes, deleted reservation, revoked or expired session each invalidate guest access', async () => {
  const login = await loggedIn();
  db.booking[0].name = 'New Guest';
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, login.token)), /예약 정보가 변경/);
  db.booking[0].name = 'Test Guest'; db.guestStaySession[0].revokedAt = new Date();
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, login.token)), /이용 기간/);
  db.guestStaySession[0].revokedAt = null; db.guestStaySession[0].expiresAt = new Date(0);
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, login.token)), /이용 기간/);
  db.guestStaySession[0].expiresAt = login.expiresAt; db.booking = [];
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, login.token)), /예약 정보가 변경/);
});
test('issuing a replacement code revokes previously authenticated phone sessions', async () => {
  const login = await loggedIn(); await credential();
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session', undefined, login.token)), /이용 기간/);
});
test('guest cannot read another slug or another reservation request, and internal notes never appear', async () => {
  const login = await loggedIn();
  await assert.rejects(requireGuestStay(req('/api/public/guest-stay/session?slug=unwadang', undefined, login.token)), /다른 숙소/);
  db.guestStayRequest = [{ id: randomUUID(), ...{ propertyId, reservationKind: 'booking', reservationId: id }, kind: 'help', details: {}, status: 'requested', publicReply: 'Visible', internalNote: 'Secret',
    source: 'mobile', createdAt: new Date(), updatedAt: new Date(), version: 1 }, { id: randomUUID(), propertyId, reservationKind: 'booking', reservationId: randomUUID() }];
  const rows = await guestStayRequests(login.stay);
  assert.equal(rows.length, 1); assert.equal('internalNote' in rows[0], false); assert.equal('guestName' in rows[0], false);
});
test('a previously open tab cannot merge a new guest cookie into its private reads', async () => {
  const first = await loggedIn();
  const second = await loginGuestStay(req(), { slug: 'anon', name: 'Test Guest', accessToken: new URL((await credential()).privatePath, 'http://localhost').searchParams.get('accessToken')! });
  const swapped = new Request('http://localhost/api/public/guest-stay/requests', { headers: {
    Cookie: `va_guest_stay=${second.token}`, 'x-guest-csrf': guestStayCsrf(first.token),
  } });
  await assert.rejects(requireGuestStay(swapped), /다른 예약으로 로그인/);
  const current = new Request('http://localhost/api/public/guest-stay/session', { headers: {
    Cookie: `va_guest_stay=${second.token}`, 'x-guest-csrf': guestStayCsrf(second.token),
  } });
  assert.equal((await requireGuestStay(current)).stay.id, id);
});
test('mobile and pad retries of the same request share one record; changed payload or foreign reservation receives conflict', async () => {
  const stay = (await liveStay(ref))!, input = { id: randomUUID(), kind: 'help', details: { category: 'issue', message: 'Heating help' } };
  assert.equal((await createGuestStayRequest(stay, input, 'mobile')).replayed, false);
  assert.equal((await createGuestStayRequest(stay, input, 'pad')).replayed, true);
  assert.equal(db.guestStayRequest.length, 1);
  await assert.rejects(createGuestStayRequest(stay, { ...input, details: { category: 'issue', message: 'Different' } }, 'mobile'), /신청 번호/);
  await assert.rejects(createGuestStayRequest({ ...stay, id: randomUUID() }, input, 'mobile'), /신청 번호/);
});
test('tour request requires the active course, valid selected ticket counts and captures original price/title', async () => {
  const stay = (await liveStay(ref))!, tourId = randomUUID(), optionId = randomUUID(), tierId = randomUUID();
  db.tour = [{ id: tourId, title: 'Hanji Workshop', isActive: true, basePrice: 30000, maxGroupSize: 6,
    durationOptions: [{ id: optionId, label: '60-minute course', durationMin: 60, price: 40000 }], ticketTiers: [{ id: tierId, label: 'Adult', price: 40000 }] }];
  const input = { id: randomUUID(), kind: 'tour', details: { tourId, date: tomorrow, time: '09:00', guests: 2, durationOptionId: optionId } };
  await assert.rejects(createGuestStayRequest(stay, input, 'mobile'), /티켓 종류/);
  await assert.rejects(createGuestStayRequest(stay, { ...input, details: { ...input.details, ticketCounts: { [tierId]: 1 } } }, 'mobile'), /참여 인원/);
  const created = await createGuestStayRequest(stay, { ...input, details: { ...input.details, ticketCounts: { [tierId]: 2 } } }, 'mobile');
  db.tour[0].title = 'Changed Title'; db.tour[0].ticketTiers[0].price = 90000;
  assert.equal(created.request.tourTitle, 'Hanji Workshop'); assert.equal(created.request.tourSnapshot?.price, 80000);
});
test('paired devices require the distinct hashed bearer and revoked devices invalidate associated guest sessions', async () => {
  const token = `gst_device_${newStayToken()}`, deviceId = randomUUID();
  db.guestStayDevice = [{ id: deviceId, propertyId, pairedAt: new Date(), revokedAt: null, tokenHash: guestStayHash(token), expiresAt: new Date(Date.now() + 60000) }];
  await assert.rejects(requireStayDevice(req()), /패드를 연결/);
  const request = new Request('http://localhost/api/public/guest-stay/device', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await requireStayDevice(request)).id, deviceId);
  db.guestStayDevice[0].revokedAt = new Date();
  await assert.rejects(requireStayDevice(request), /해제/);
});
test('pad never chooses one of two overlapping active reservations', async () => {
  db.booking.push({ ...db.booking[0], id: randomUUID(), name: 'Other Guest' });
  await assert.rejects(currentDeviceStay(propertyId), /현재 투숙 예약/);
});
test('a pad form opened for the departing guest cannot submit for the next guest after turnover', async () => {
  const first = (await liveStay(ref))!, deviceId = randomUUID(), proof = deviceStayProof(deviceId, first);
  assert.doesNotThrow(() => requireDeviceStayProof(deviceId, first, proof));
  const next = { ...first, id: randomUUID(), fingerprint: guestStayHash('next reservation') };
  assert.throws(() => requireDeviceStayProof(deviceId, next, proof), /투숙 예약이 변경/);
  assert.throws(() => requireDeviceStayProof(randomUUID(), first, proof), /투숙 예약이 변경/);
  assert.throws(() => requireDeviceStayProof(deviceId, first, null), /투숙 예약이 변경/);
});
test('login throttle remains effective across calls instead of process-local request state', async () => {
  for (let n = 0; n < 3; n++) await throttleStayAttempt(req(), 'test-bucket', 3);
  await assert.rejects(throttleStayAttempt(req(), 'test-bucket', 3), /잠시 후/);
  assert.equal([...buckets.values()][0], 4);
});
test('oversized request bodies are rejected before parsing fields', async () => {
  await assert.rejects(readStayJson(req('/api', { text: 'a'.repeat(17000) })), /너무 깁니다/);
});
test('pairing code is short-lived, property-bound and single-use', async () => {
  const code = 'ABCD-EFGH-JKLM';
  db.guestStayDevice = [{ id: randomUUID(), propertyId, label: 'Room pad', pairingHash: guestStayHash(normalizeStayCode(code)),
    pairingExpiresAt: new Date(Date.now() + 60000), expiresAt: new Date(Date.now() + 3600000), pairedAt: null, revokedAt: null }];
  assert.equal((await pairDevice(req('/api', { slug: 'unwadang', pairingCode: code }), { params: Promise.resolve({}) })).status, 401);
  const success = await pairDevice(req('/api', { slug: 'anon', pairingCode: code }), { params: Promise.resolve({}) });
  assert.equal(success.status, 200); assert.ok((success as unknown as StubResponse).body.deviceToken.startsWith('gst_device_'));
  assert.equal((await pairDevice(req('/api', { slug: 'anon', pairingCode: code }), { params: Promise.resolve({}) })).status, 401);
});
test('staff query rejects invalid dates and property scope, and issuance requires authorized property', async () => {
  assert.equal((await adminGet(req('/api/guest-stays?from=2026-02-30&to=2026-03-10'), { params: Promise.resolve({}) })).status, 400);
  actAsManager([otherProperty]);
  assert.equal((await adminGet(req(`/api/guest-stays?propertyId=${propertyId}`), { params: Promise.resolve({}) })).status, 403);
  assert.equal((await issueAccess(req('/api/guest-stays/access', { kind: 'booking', id }), { params: Promise.resolve({}) })).status, 403);
});
test('staff updates use optimistic versions and keep public reply separate from internal note', async () => {
  const stay = (await liveStay(ref))!, input = { id: randomUUID(), kind: 'help', details: { category: 'issue', message: 'Need help' } };
  await createGuestStayRequest(stay, input, 'mobile');
  const path = `/api/guest-stays/requests/${input.id}`;
  const stale = await updateRequest(req(path, { status: 'reviewing', publicReply: 'On our way', internalNote: 'Internal', version: 2 }), { params: Promise.resolve({ id: input.id }) });
  assert.equal(stale.status, 409);
  const updated = await updateRequest(req(path, { status: 'reviewing', publicReply: 'On our way', internalNote: 'Internal', version: 1 }), { params: Promise.resolve({ id: input.id }) });
  assert.equal(updated.status, 200); assert.equal((await guestStayRequests(stay))[0].publicReply, 'On our way');
  assert.equal(JSON.stringify(await guestStayRequests(stay)).includes('Internal'), false);
});
