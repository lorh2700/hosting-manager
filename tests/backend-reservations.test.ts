import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '../generated/prisma/client';
import type { BackendIdentity } from '../packages/domain/identity/access';
import { createReservationCommandService } from '../packages/domain/reservations/commands';
import { createReservationService } from '../packages/domain/reservations/service';
import { calendarAvailability, matchesRemote, type RemoteReservation } from '../packages/domain/reservations/gateway';
import { reservationRows, scopedGuestRows } from '../packages/data/reservation-repository';
import { createGuestLinkStore } from '../lib/guest-link-store';

interface Sql { query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }> }
const now = new Date('2026-10-05T03:00:00Z');
const actor = { session: { userId: 'staff-a', email: 'staff@example.invalid', expiresAt: 2_000_000_000 }, user: { id: 'staff-a', role: 'admin', status: 'active', organizationId: 'org-a', enabledModules: null, displayName: '예시 관리자', email: 'staff@example.invalid' }, role: 'admin', isAdmin: false, isBusinessAdmin: true, organizationId: 'org-a', organizationStatus: 'active', organizationFeatures: {} } as BackendIdentity;
const input = { propertyId: 'property-a', checkIn: '2026-10-20', checkOut: '2026-10-22', name: '예시 예약자', email: 'guest@example.invalid', phone: '', adults: 2, children: 0, notes: '내부 메모', tags: [] };
function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((part: any) => matches(row, part));
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'users') return value.some?.userId === 'staff-a';
    if (value && typeof value === 'object') { if ('in' in value) return value.in.includes(row[key]); if ('notIn' in value) return !value.notIn.includes(row[key]); return matches(row[key] as Record<string, unknown>, value); }
    return row[key] === value;
  });
}
function db(sql: Sql): Prisma.TransactionClient {
  function statement(parts: any, values: unknown[]) { return Array.isArray(parts) ? { text: parts.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, ''), values } : { text: parts.text, values: parts.values }; }
  const events = async () => (await sql.query<any>('SELECT * FROM events')).rows.map(row => ({ id: row.id, propertyId: row.property_id, channelId: row.channel_id, originalUid: row.original_uid, type: row.type, source: row.source, title: row.title, startDate: row.start_date, endDate: row.end_date, numAdults: row.num_adults, numChildren: row.num_children, guestEmail: row.guest_email, guestPhone: row.guest_phone, description: row.description, tags: row.tags, createdAt: new Date('2026-10-01') }));
  const bookings = async () => (await sql.query<any>('SELECT * FROM bookings')).rows.map(row => ({ id: row.id, propertyId: row.property_id, name: row.name, checkIn: row.check_in, checkOut: row.check_out, status: row.status, source: row.source, guests: row.guests, channelBookingRef: row.channel_booking_ref, email: null, phone: null, message: null, createdAt: new Date('2026-10-01') }));
  return {
    $queryRaw: async (parts: any, ...values: unknown[]) => { const query = statement(parts, values); return (await sql.query(query.text, query.values)).rows; },
    $executeRaw: async (parts: any, ...values: unknown[]) => { const query = statement(parts, values); return (await sql.query(query.text, query.values)).affectedRows ?? 0; },
    property: { findMany: async ({ where }: any) => (await sql.query<any>('SELECT * FROM properties')).rows.map(row => ({ id: row.id, name: row.name, organizationId: row.organization_id, status: 'active', beds24RoomId: '10', beds24PropId: '20', maxGuests: 6, slug: 'anon', featureOverrides: {}, organization: { id: row.organization_id, name: row.organization_id, status: 'active', features: {} } })).filter(row => matches(row, where)) },
    event: {
      findUnique: async ({ where }: any) => (await events()).find(row => row.id === where.id) || null,
      findUniqueOrThrow: async ({ where }: any) => { const row = (await events()).find(row => row.id === where.id); if (!row) throw Error('missing'); return row; },
      upsert: async ({ create }: any) => { const previous = (await events()).find(row => row.propertyId === create.propertyId && row.originalUid === create.originalUid && row.channelId === create.channelId); if (previous) return previous; const id = randomUUID(); await sql.query('INSERT INTO events(id,property_id,channel_id,original_uid,type,source,title,start_date,end_date,num_adults,num_children,guest_email,guest_phone,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [id, create.propertyId, create.channelId, create.originalUid, create.type, create.source, create.title, create.startDate, create.endDate, create.numAdults, create.numChildren, create.guestEmail, create.guestPhone, create.tags]); return (await events()).find(row => row.id === id); },
      deleteMany: async ({ where }: any) => { let count = 0; for (const row of (await events()).filter(row => matches(row, where))) { await sql.query('DELETE FROM events WHERE id=$1', [row.id]); count++; } return { count }; },
    },
    booking: { findUnique: async ({ where }: any) => (await bookings()).find(row => row.id === where.id) || null,
      findUniqueOrThrow: async ({ where }: any) => { const row = (await bookings()).find(row => row.id === where.id); if (!row) throw Error('missing'); return row; },
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of (await bookings()).filter(row => matches(row, where))) { await sql.query('UPDATE bookings SET status=$2 WHERE id=$1', [row.id, data.status]); count++; } return { count }; } },
    checkoutOrder: { findFirst: async () => null }, cleaning: { findMany: async () => [] }, message: { findMany: async () => [] },
    guestReservation: {
      upsert: async ({ create }: any) => { await sql.query('INSERT INTO guest_reservations(id,key,property_id,name,email,phone,check_in,check_out,status,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(key) DO UPDATE SET status=EXCLUDED.status', [randomUUID(), create.key, create.propertyId, create.name, create.email, create.phone, create.checkIn, create.checkOut, create.status, create.source]); return create; },
      updateMany: async ({ where, data }: any) => ({ count: (await sql.query('UPDATE guest_reservations SET status=$3 WHERE property_id=$1 AND key=$2', [where.propertyId, where.key, data.status])).affectedRows }),
    },
    auditLog: { create: async ({ data }: any) => sql.query('INSERT INTO test_audits(action,organization_id) VALUES($1,$2)', [data.action, data.organizationId]) },
  } as unknown as Prisma.TransactionClient;
}
async function fixture() {
  const sql = new PGlite();
  await sql.exec(`CREATE TABLE properties(id TEXT PRIMARY KEY,name TEXT,organization_id TEXT); INSERT INTO properties VALUES('property-a','숙소 A','org-a'),('property-b','숙소 B','org-b');
    CREATE TABLE guests(id TEXT PRIMARY KEY); CREATE TABLE events(id TEXT PRIMARY KEY,property_id TEXT,channel_id TEXT,original_uid TEXT,type TEXT,source TEXT,title TEXT,start_date TEXT,end_date TEXT,num_adults INT,num_children INT,guest_email TEXT,guest_phone TEXT,description TEXT,tags TEXT[] DEFAULT '{}');
    CREATE TABLE bookings(id TEXT PRIMARY KEY,property_id TEXT,name TEXT,check_in TEXT,check_out TEXT,status TEXT,source TEXT,guests INT,channel_booking_ref TEXT);
    CREATE TABLE guest_reservations(id TEXT PRIMARY KEY,key TEXT UNIQUE,property_id TEXT,guest_id TEXT,name TEXT,email TEXT,phone TEXT,check_in TEXT,check_out TEXT,status TEXT,source TEXT);
    CREATE TABLE cleanings(id TEXT PRIMARY KEY,property_id TEXT,date TEXT,origin TEXT,status TEXT,completed_at TIMESTAMP,is_open BOOLEAN,cleaner_id TEXT);
    CREATE TABLE test_audits(action TEXT,organization_id TEXT); CREATE ROLE anon; CREATE ROLE authenticated;`);
  await sql.exec(await readFile(new URL('../prisma/migrations/20261005150000_reservation_workflows/migration.sql', import.meta.url), 'utf8'));
  await sql.exec(await readFile(new URL('../prisma/migrations/20261013120000_guest_link_tokens/migration.sql', import.meta.url), 'utf8'));
  const state = { actor: structuredClone(actor) as BackendIdentity | null, writes: 0, cancelWrites: 0, remote: null as RemoteReservation | null, uncertain: false, available: true, auditFailure: false, paid: false };
  const options = { transaction: async <T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) => sql.transaction(async transaction => { const client = db(transaction); if (state.auditFailure) client.auditLog.create = (async () => { throw Error('audit unavailable'); }) as unknown as typeof client.auditLog.create; if (state.paid) client.checkoutOrder.findFirst = (async () => ({ id: 'paid-order' })) as unknown as typeof client.checkoutOrder.findFirst; return handler(client); }), refreshActor: async () => state.actor,
    now: () => now, encryptionSecret: 'reservation-secret-for-local-fixture-32-characters', invitationSecret: 'legacy-jwt-secret-local-fixture', guestWebOrigin: 'https://voidanchae.com', gateway: {
      availability: async () => ({ available: state.available, reason: state.available ? null : '매진' }),
      create: async (_input: unknown, roomId: string, marker: string) => { state.writes++; if (state.uncertain) throw Error('timeout'); state.remote = { id: '500', roomId, checkIn: input.checkIn, checkOut: input.checkOut, marker, status: 'confirmed', channel: '', name: input.name }; return { id: '500' }; },
      find: async () => state.remote,
      cancel: async () => { state.cancelWrites++; if (state.remote) state.remote.status = 'cancelled'; },
    } };
  return { sql, state, options, service: createReservationCommandService(options) };
}
test('reservation scope excludes another business and denies cleaner access', async () => {
  const f = await fixture(); try { const service = createReservationService(db(f.sql), f.options); assert.deepEqual((await service.scope(actor)).map(row => row.id), ['property-a']); await assert.rejects(service.scope(actor, { propertyId: 'property-b' })); await assert.rejects(service.scope({ ...actor, role: 'cleaner' })); } finally { await f.sql.close(); }
});
test('verified creation commits once, encrypts PII, replays and rejects changed payload', async () => {
  const f = await fixture(); try { const key = randomUUID(); const first = await f.service.execute(actor, 'create', key, input); assert.equal(first.state, 'confirmed'); assert.match(first.reservationId!, /^event:/); const second = await f.service.execute(actor, 'create', key, input); assert.deepEqual(second, first); assert.equal(f.state.writes, 1);
    await assert.rejects(f.service.execute(actor, 'create', key, { ...input, name: '다른 예약자' }), /다른 예약/);
    const rows = await f.sql.query<{ payload_ciphertext: string }>('SELECT payload_ciphertext FROM backend_reservation_commands'); assert.ok(!rows.rows[0].payload_ciphertext.includes(input.email));
    const detailService = createReservationService(db(f.sql), f.options), detail = await detailService.detail(actor, first.reservationId!); assert.equal(detail.notes, input.notes); const invitation = await detailService.invitation(actor, first.reservationId!, { language: 'en' }); const url = new URL(invitation.url); const { reference: ref } = await createGuestLinkStore(db(f.sql)).invitation(url.pathname.split('/').at(-1)!, now.getTime()); assert.equal(ref?.id, first.reservationId!.slice(6)); assert.equal(url.origin, 'https://voidanchae.com'); assert.ok(url.href.length <= 60);
    f.state.actor = { ...actor, organizationId: 'org-b', user: { ...actor.user, organizationId: 'org-b' } }; await assert.rejects(f.service.execute(actor, 'create', key, input), /숙소/);
  } finally { await f.sql.close(); }
});
test('uncertain POST is not repeated; marker lookup recovers only matching remote booking', async () => {
  const f = await fixture(); try { f.state.uncertain = true; const key = randomUUID(), first = await f.service.execute(actor, 'create', key, input); assert.equal(first.state, 'needs_review'); assert.equal((await f.service.execute(actor, 'create', key, input)).state, 'needs_review'); assert.equal(f.state.writes, 1);
    f.state.remote = { id: '501', roomId: '10', checkIn: input.checkIn, checkOut: input.checkOut, marker: 'wrong-marker', status: 'confirmed', channel: '', name: input.name }; assert.equal((await f.service.reconcile(actor, first.commandId)).state, 'needs_review'); assert.equal((await f.sql.query('SELECT * FROM events')).rows.length, 0);
    f.state.remote.marker = `void-staff:${first.commandId}`; assert.equal((await f.service.reconcile(actor, first.commandId)).state, 'confirmed'); assert.equal(f.state.writes, 1); assert.equal((await f.sql.query('SELECT * FROM events')).rows.length, 1);
  } finally { await f.sql.close(); }
});
test('local commit failure is recoverable without second external POST', async () => {
  const f = await fixture(); try { f.state.auditFailure = true; const key = randomUUID(); await assert.rejects(f.service.execute(actor, 'create', key, input), /audit unavailable/); assert.equal((await f.sql.query('SELECT * FROM events')).rows.length, 0); f.state.auditFailure = false; assert.equal((await f.service.execute(actor, 'create', key, input)).state, 'confirmed'); assert.equal(f.state.writes, 1); } finally { await f.sql.close(); }
});
test('cancel preserves completed and manual cleaning, cancels only orphan automatic pending work', async () => {
  const f = await fixture(); try { const created = await f.service.execute(actor, 'create', randomUUID(), input), detail = await createReservationService(db(f.sql), f.options).detail(actor, created.reservationId!);
    await f.sql.exec("INSERT INTO cleanings VALUES('pending','property-a','2026-10-22','auto','pending',NULL,true,'cleaner-a'),('done','property-a','2026-10-22','auto','done','2026-10-22',false,'cleaner-a'),('manual','property-a','2026-10-22','manual','pending',NULL,true,'cleaner-a');");
    const cancelled = await f.service.execute(actor, 'cancel', randomUUID(), { version: detail.version, reason: '게스트 요청' }, detail.id); assert.equal(cancelled.state, 'cancelled'); assert.equal(f.state.cancelWrites, 1); const rows = (await f.sql.query<{ id: string; status: string; cleaner_id: string }>('SELECT id,status,cleaner_id FROM cleanings ORDER BY id')).rows; assert.deepEqual(rows.map(row => [row.id, row.status]), [['done', 'done'], ['manual', 'pending'], ['pending', 'cancelled']]); assert.ok(rows.every(row => row.cleaner_id === 'cleaner-a'));
  } finally { await f.sql.close(); }
});
test('same checkout from another reservation retains cleaning', async () => {
  const f = await fixture(); try { const created = await f.service.execute(actor, 'create', randomUUID(), input), service = createReservationService(db(f.sql), f.options), detail = await service.detail(actor, created.reservationId!);
    await f.sql.exec("INSERT INTO cleanings VALUES('pending','property-a','2026-10-22','auto','pending',NULL,true,NULL); INSERT INTO bookings VALUES('other','property-a','다른 게스트','2026-10-20','2026-10-22','confirmed','direct',2,NULL);");
    await f.service.execute(actor, 'cancel', randomUUID(), { version: detail.version, reason: '게스트 요청' }, detail.id); assert.equal((await f.sql.query<{ status: string }>("SELECT status FROM cleanings WHERE id='pending'")).rows[0].status, 'pending');
  } finally { await f.sql.close(); }
});
test('guest query uses scoped snapshots and reservation query deduplicates a synced direct booking', async () => {
  const f = await fixture(); try {
    await f.sql.exec("INSERT INTO guests VALUES('shared'); INSERT INTO guest_reservations VALUES('a','a','property-a','shared','사업자 A 이름','a@example.invalid',NULL,'2026-10-01','2026-10-02','confirmed','direct'),('b','b','property-b','shared','사업자 B 비밀 이름','b@example.invalid',NULL,'2026-11-01','2026-11-02','confirmed','direct'); INSERT INTO events(id,property_id,channel_id,original_uid,type,title,start_date,end_date,num_adults) VALUES('event-a','property-a','beds24','777','reservation','예약','2026-10-01','2026-10-02',2); INSERT INTO bookings VALUES('booking-a','property-a','예약','2026-10-01','2026-10-02','confirmed','direct',2,'777');");
    const guests = await scopedGuestRows(db(f.sql), ['property-a'], { q: '', limit: 25, offset: 0 }); assert.equal(guests.length, 1); assert.equal(guests[0].email, 'a@example.invalid'); assert.equal(guests[0].reservationCount, 1); assert.equal((await scopedGuestRows(db(f.sql), ['property-a'], { q: 'b@example', limit: 25, offset: 0 })).length, 0);
    const reservations = await reservationRows(db(f.sql), ['property-a'], { q: '', status: 'all', from: '2026-10-01', to: '2026-10-31', limit: 25, offset: 0 }); assert.deepEqual(reservations.map(row => row.id), ['event:event-a']);
    const grants = await f.sql.query<{ allowed: boolean }>("SELECT has_table_privilege('anon','backend_reservation_commands','SELECT') AS allowed"); assert.equal(grants.rows[0].allowed, false);
  } finally { await f.sql.close(); }
});
test('availability rejects missing dates, stay-through restrictions and unverified identity', () => {
  assert.equal(calendarAvailability({ strategy: 'firstNight', days: {} }, '2026-10-01', '2026-10-03').available, false);
  assert.equal(matchesRemote(null, { roomId: '1', checkIn: '2026-10-01', checkOut: '2026-10-03' }), false);
});
test('inquiry title or tag is excluded from list, detail, invitation and replay authorization', async () => {
  const f = await fixture(); try {
    await f.sql.exec("INSERT INTO events(id,property_id,type,title,start_date,end_date,tags) VALUES('inquiry-title','property-a','reservation','[문의] 예약 전 문의','2026-10-20','2026-10-22','{}'),('inquiry-tag','property-a','reservation','예시 게스트','2026-10-20','2026-10-22','{inquiry}');");
    const service = createReservationService(db(f.sql), f.options), query = new URLSearchParams({ from: '2026-10-01', to: '2026-10-31' }); assert.equal((await service.list(actor, query)).items.length, 0);
    for (const id of ['event:inquiry-title', 'event:inquiry-tag']) { await assert.rejects(service.detail(actor, id), /확정된 투숙/); await assert.rejects(service.invitation(actor, id, { language: 'ko' }), /확정된 투숙/); await assert.rejects(service.authorizeCommand(actor, 'updateReservation', id, {}), /확정된 투숙/); }
  } finally { await f.sql.close(); }
});
test('cancelling booking reference removes the same-room synced event without touching another property', async () => {
  const f = await fixture(); try {
    const created = await f.service.execute(actor, 'create', randomUUID(), input);
    await f.sql.exec("INSERT INTO bookings VALUES('linked','property-a','예약자','2026-10-20','2026-10-22','confirmed','direct',2,'500'); INSERT INTO events(id,property_id,channel_id,original_uid,type,title,start_date,end_date) VALUES('other-property-event','property-b','beds24','500','reservation','다른 사업자','2026-10-20','2026-10-22');");
    const detail = await createReservationService(db(f.sql), f.options).detail(actor, 'booking:linked');
    assert.equal((await f.service.execute(actor, 'cancel', randomUUID(), { version: detail.version, reason: '취소 요청' }, detail.id)).state, 'cancelled');
    assert.equal((await f.sql.query('SELECT * FROM events WHERE id=$1', [created.reservationId!.slice(6)])).rows.length, 0);
    assert.equal((await f.sql.query("SELECT * FROM events WHERE id='other-property-event'")).rows.length, 1);
    assert.equal((await f.sql.query<{ status: string }>("SELECT status FROM bookings WHERE id='linked'")).rows[0].status, 'cancelled');
  } finally { await f.sql.close(); }
});
test('old uncertain requests remain first and every command page is reachable', async () => {
  const f = await fixture(); try {
    f.state.uncertain = true; const uncertain = await f.service.execute(actor, 'create', randomUUID(), input);
    await f.sql.query("UPDATE backend_reservation_commands SET created_at=CURRENT_TIMESTAMP - INTERVAL '10 days' WHERE id=$1", [uncertain.commandId]);
    for (let index = 0; index < 4; index++) await f.sql.query("INSERT INTO backend_reservation_commands(id,actor_id,property_id,operation,key_hash,body_hash,payload_ciphertext,state) VALUES($1,'staff-a','property-a','create',$1,'hash','encrypted','confirmed')", [`later-${index}`]);
    const first = await f.service.list(actor, new URLSearchParams({ limit: '2' })); assert.equal(first.items[0].commandId, uncertain.commandId); assert.equal(first.nextCursor, '2');
    const second = await f.service.list(actor, new URLSearchParams({ limit: '2', cursor: first.nextCursor! })); assert.equal(second.items.length, 2); const third = await f.service.list(actor, new URLSearchParams({ limit: '2', cursor: second.nextCursor! })); assert.equal(third.items.length, 1); assert.equal(third.hasMore, false);
  } finally { await f.sql.close(); }
});
test('payment protection refuses cancellation before any external write', async () => {
  const f = await fixture(); try { const created = await f.service.execute(actor, 'create', randomUUID(), input), detail = await createReservationService(db(f.sql), f.options).detail(actor, created.reservationId!); f.state.paid = true; await assert.rejects(f.service.execute(actor, 'cancel', randomUUID(), { version: detail.version, reason: '취소 요청' }, detail.id), /환불/); assert.equal(f.state.cancelWrites, 0); } finally { await f.sql.close(); }
});
test('simultaneous same-key requests issue at most one Beds24 creation', async () => {
  const f = await fixture(); try { const key = randomUUID(); const results = await Promise.all([f.service.execute(actor, 'create', key, input), f.service.execute(actor, 'create', key, input)]); assert.equal(f.state.writes, 1); assert.equal(new Set(results.map(row => row.commandId)).size, 1); assert.equal((await f.service.reconcile(actor, results[0].commandId)).state, 'confirmed'); } finally { await f.sql.close(); }
});
