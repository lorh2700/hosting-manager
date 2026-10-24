import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createReservationBarrierStore, reservationRequestHash, type ReservationBarrierSql } from '../lib/rate-reservation-barrier';
import { db, resetDb, prismaOverrides } from './stubs/prisma';
import { getPrice, checkoutMarker } from '../lib/payments/beds';
import { startCheckout, reconcileCheckout } from '../lib/payments/checkout';
import { registerBeds24BookingVerified, cancelBeds24Booking } from '../lib/beds24-register';
import { json, resetFetch, setFetchHandler, fetchLog } from './helpers/beds24-mock';
import type { CheckoutOrder } from '../generated/prisma/client';

const dates = { checkIn: '2027-10-01', checkOut: '2027-10-03' };
const input = { ...dates, roomId: 555, propertyId: 'p1', offerId: 1, id: 'test-reservation-marker', requestHash: reservationRequestHash({ test: 'original' }) };
const environment = { RATES_CONNECTION_SECRETS_JSON: '{"BEDS_TEST":{"generation":1,"refreshToken":"test-refresh-token"}}' };
const adapter = (sql: Pick<PGlite, 'query'>): ReservationBarrierSql => ({
  $queryRawUnsafe: async <T>(statement: string, ...values: unknown[]) => (await sql.query(statement, values)).rows as T,
  $executeRawUnsafe: async (statement, ...values) => (await sql.query(statement, values)).affectedRows || 0,
});
async function fixture() {
  const sql = new PGlite();
  await sql.exec(`CREATE TABLE properties(id TEXT PRIMARY KEY,organization_id TEXT,beds24_room_id TEXT,beds24_prop_id TEXT);
    INSERT INTO properties VALUES('p1','org1','555','111'),('foreign','org2','556','112');
    CREATE TABLE rate_connections(id TEXT PRIMARY KEY,organization_id TEXT,provider TEXT,state TEXT,secret_ref TEXT,credential_generation INTEGER);
    INSERT INTO rate_connections VALUES('connection1','org1','beds24','ready','BEDS_TEST',1);
    CREATE TABLE property_rooms(id TEXT PRIMARY KEY,organization_id TEXT,property_id TEXT,beds24_room_id TEXT,beds24_property_id TEXT,beds24_connection_id TEXT,offer_id INTEGER,version INTEGER,active BOOLEAN);
    INSERT INTO property_rooms VALUES('room1','org1','p1','555','111','connection1',1,1,TRUE);
    CREATE TABLE room_reservation_barriers(id TEXT PRIMARY KEY,room_id TEXT,organization_id TEXT,from_date DATE,to_exclusive DATE,state TEXT,mapping JSONB,updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE room_sales_blocks(id TEXT,room_id TEXT,date DATE,active BOOLEAN);
    CREATE TABLE calendar_changes(id TEXT PRIMARY KEY,room_id TEXT,state TEXT);
    CREATE TABLE calendar_change_items(command_id TEXT,date DATE);`);
  const store = createReservationBarrierStore({ transaction: work => sql.transaction(tx => work(adapter(tx))), environment: () => environment, refreshToken: () => 'test-refresh-token' });
  return { sql, store };
}
function bind(sql: PGlite) {
  prismaOverrides.$queryRaw = async () => [{ present: true, ready: true }];
  prismaOverrides.$queryRawUnsafe = adapter(sql).$queryRawUnsafe;
  prismaOverrides.$executeRawUnsafe = adapter(sql).$executeRawUnsafe;
  process.env.RATES_CONNECTION_SECRETS_JSON = environment.RATES_CONNECTION_SECRETS_JSON;
}
beforeEach(() => { resetDb(); resetFetch(); });

test('quote checks are read-only, retain old installations, and reject incomplete migrations', async () => {
  const fx = await fixture(); try {
    await fx.store.check(input);
    assert.equal((await fx.sql.query('SELECT * FROM room_reservation_barriers')).rows.length, 0);
    await fx.sql.exec('DROP TABLE room_reservation_barriers');
    await assert.rejects(fx.store.check(input), { status: 503 });
    await fx.sql.exec('DROP TABLE property_rooms');
    await fx.store.check({ ...input, id: undefined });
  } finally { await fx.sql.close(); }
});

test('sales blocks and every nonterminal price change block only occupied nights', async () => {
  const fx = await fixture(); try {
    await fx.sql.exec("INSERT INTO room_sales_blocks VALUES('block','room1','2027-10-03',TRUE)");
    await fx.store.check(input);
    await fx.sql.exec("INSERT INTO room_sales_blocks VALUES('occupied','room1','2027-10-02',TRUE)");
    await assert.rejects(fx.store.check(input), { status: 409 });
    await fx.sql.exec('DELETE FROM room_sales_blocks');
    for (const state of ['queued','processing','delivery_pending','needs_review']) {
      await fx.sql.exec(`DELETE FROM calendar_changes;DELETE FROM calendar_change_items;INSERT INTO calendar_changes VALUES('change','room1','${state}');INSERT INTO calendar_change_items VALUES('change','2027-10-02')`);
      await assert.rejects(fx.store.check(input), { status: 409 });
      await assert.rejects(fx.store.begin(input), { status: 409 });
    }
    await fx.sql.exec("UPDATE calendar_changes SET state='verified'");
    await fx.store.check(input);
  } finally { await fx.sql.close(); }
});

test('reservation markers serialize claims and forbid a second POST after an unknown outcome', async () => {
  const fx = await fixture(); try {
    assert.equal((await fx.store.begin(input))?.state, 'prepared');
    assert.equal((await fx.store.begin(input))?.state, 'prepared');
    const outcomes = await Promise.allSettled([fx.store.claimSend(input), fx.store.claimSend(input)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    await fx.store.finish(input.id, 'needs_review');
    assert.equal((await fx.store.begin(input))?.state, 'needs_review');
    await assert.rejects(fx.store.claimSend(input), { status: 409 });
    await assert.rejects(fx.store.check({ ...input, id: undefined }), { status: 409 });
    await assert.rejects(fx.store.begin({ ...input, requestHash: 'different' }), { status: 409 });
    await fx.store.finish(input.id, 'held', '123');
    await fx.store.check({ ...input, id: undefined });
    assert.equal((await fx.store.begin(input))?.observedBookingId, '123');
    await fx.store.finish(input.id, 'confirmed', '123');
    await fx.store.finish(input.id, 'released', '123');
    assert.equal((await fx.store.begin(input))?.state, 'released');
  } finally { await fx.sql.close(); }
});

test('foreign room, changed mapping, credentials, and disappearing mapping never reach send', async () => {
  const fx = await fixture(); try {
    await assert.rejects(fx.store.begin({ ...input, propertyId: 'foreign' }), { status: 409 });
    await assert.rejects(fx.store.check({ ...input, offerId: 2 }), { status: 409 });
    await fx.sql.exec("UPDATE rate_connections SET credential_generation=2");
    await assert.rejects(fx.store.begin(input), { status: 503 });
    await fx.sql.exec("UPDATE rate_connections SET credential_generation=1");
    await fx.store.begin(input);
    await fx.sql.exec("UPDATE property_rooms SET version=2");
    await assert.rejects(fx.store.claimSend(input), { status: 409 });
    await fx.sql.exec("UPDATE property_rooms SET active=FALSE");
    await assert.rejects(fx.store.begin(input), { status: 409 });
    await assert.rejects(fx.store.check(input), { status: 409 });
    await assert.rejects(fx.store.claimSend(input), { status: 409 });
    await fx.sql.exec("UPDATE property_rooms SET active=TRUE;UPDATE properties SET organization_id='org2' WHERE id='p1'");
    await assert.rejects(fx.store.check(input), { status: 409 });
  } finally { await fx.sql.close(); }
});

test('managed quote refuses blocked dates before any external offer request', async () => {
  const fx = await fixture(); try {
    bind(fx.sql);
    await fx.sql.exec("INSERT INTO room_sales_blocks VALUES('block','room1','2027-10-01',TRUE)");
    setFetchHandler(() => { throw new Error('must not call Beds24'); });
    await assert.rejects(getPrice(555, 1, dates.checkIn, dates.checkOut, 2), { status: 409 });
    assert.equal(fetchLog.length, 0);
    assert.equal((await fx.sql.query('SELECT * FROM room_reservation_barriers')).rows.length, 0);
  } finally { await fx.sql.close(); }
});

const checkoutId = 'e1a6bb45-d76c-4322-b270-76934162bf35';
function order(): CheckoutOrder {
  return { id: checkoutId, propertyId: 'p1', roomId: 555, offerId: 1, propertyName: 'Test', ...dates,
    guests: 2, priceKrw: 350000, stayOptions: null, tokenHash: 'hash', name: 'Test Guest', email: 'test@example.test', phone: '+12025550100',
    gateway: 'card', mode: 'test', currency: 'KRW', amountMinor: 350000, fxRate: null, terms: 'test', termsAcceptedAt: null,
    status: 'quoted', beds24Id: null, paymentKey: null, bookingId: null, paypalRefundId: null, paypalRefundRequestedAt: null,
    expiresAt: new Date(Date.now() + 900000), leaseUntil: null, lastError: null, createdAt: new Date(), updatedAt: new Date() };
}
function paymentSettings() {
  process.env.CHECKOUT_ENABLED = 'true'; process.env.CHECKOUT_MODE = 'test'; process.env.CHECKOUT_PROPERTY_IDS = 'p1';
  process.env.CHECKOUT_BEDS24_OFFER_ID = '1'; process.env.CHECKOUT_SITE_URL = 'http://localhost:3100'; process.env.CHECKOUT_TERMS = 'test';
  process.env.CHECKOUT_PRICE_INCLUDES_ALL_FEES = 'true'; process.env.TOSS_CLIENT_KEY = 'test_ck_fake'; process.env.TOSS_SECRET_KEY = 'test_sk_fake';
  process.env.CRON_SECRET = 'test-cron';
}
test('checkout prepares before re-price, recovers a lost hold once, and confirms a paid hold despite new sales blocks', async () => {
  const fx = await fixture(); try {
    bind(fx.sql); paymentSettings(); db.checkoutOrder = [order()];
    let created = 0, status = 'black';
    setFetchHandler(async (url, init) => {
      if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
      if (url.pathname.endsWith('/inventory/rooms/offers')) {
        assert.equal((await fx.sql.query<{state:string}>('SELECT state FROM room_reservation_barriers')).rows[0].state, 'prepared');
        return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 350000, unitsAvailable: 1 }] }] });
      }
      if (url.hostname === 'api.tosspayments.com') return json({ orderId: checkoutId, paymentKey: 'pk', currency: 'KRW', totalAmount: 350000, status: 'DONE' });
      if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
        const body = JSON.parse(init.body!)[0];
        if (!body.id) { created++; assert.equal((await fx.sql.query<{state:string}>('SELECT state FROM room_reservation_barriers')).rows[0].state, 'sent'); throw new Error('response lost'); }
        status = body.status; return json([{ success: true }]);
      }
      if (url.pathname.endsWith('/bookings')) return json({ data: [{ id: 123, roomId: 555, arrival: dates.checkIn, departure: dates.checkOut, custom1: checkoutMarker(checkoutId), status }] });
      throw new Error(`Unexpected test request ${url.pathname}`);
    });
    await assert.rejects(startCheckout(db.checkoutOrder[0] as CheckoutOrder));
    assert.equal(created, 1);
    assert.equal((await fx.sql.query<{state:string}>('SELECT state FROM room_reservation_barriers')).rows[0].state, 'needs_review');
    await fx.sql.exec("INSERT INTO room_sales_blocks VALUES('later','room1','2027-10-01',TRUE)");
    await reconcileCheckout(checkoutId);
    assert.equal(db.checkoutOrder[0].status, 'confirmed');
    assert.equal(created, 1);
    assert.equal((await fx.sql.query<{state:string}>('SELECT state FROM room_reservation_barriers')).rows[0].state, 'confirmed');
  } finally { await fx.sql.close(); }
});

test('managed direct booking retries only reads after a lost response, even if an immediate search is empty', async () => {
  const fx = await fixture(); try {
    bind(fx.sql);
    let created = 0, marker = '', visible = false;
    setFetchHandler((url, init) => {
      if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
      if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
        const body = JSON.parse(init.body!)[0]; created++; marker = body.custom1; assert.equal(body.actions.checkAvailability, true); throw new Error('response lost');
      }
      if (url.pathname.endsWith('/bookings')) return json({ data: visible ? [{ id: 123, roomId: 555, arrival: dates.checkIn, departure: dates.checkOut, status: 'confirmed', firstName: 'Guest', lastName: '', custom1: marker }] : [], pages: { nextPageExists: false } });
      throw new Error('unexpected request');
    });
    const request = { kind: 'reservation' as const, roomId: 555, arrival: dates.checkIn, departure: dates.checkOut, firstName: 'Guest', lastName: '', deadlineAt: Date.now() + 22000, logPrefix: 'test' };
    assert.equal((await registerBeds24BookingVerified(request)).ok, false);
    assert.equal((await registerBeds24BookingVerified(request)).ok, false);
    assert.equal(created, 1);
    visible = true;
    assert.equal((await registerBeds24BookingVerified(request)).ok, true);
    assert.equal((await registerBeds24BookingVerified(request)).ok, true);
    assert.equal(created, 1);
    await assert.rejects(registerBeds24BookingVerified({ ...request, notes: 'changed' }), { status: 409 });
  } finally { await fx.sql.close(); }
});

test('changed managed price releases only its unsent marker and never creates a hold', async () => {
  const fx = await fixture(); try {
    bind(fx.sql); paymentSettings(); db.checkoutOrder = [order()];
    setFetchHandler(url => {
      if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
      if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 360000, unitsAvailable: 1 }] }] });
      throw new Error('must not create a hold');
    });
    await assert.rejects(startCheckout(db.checkoutOrder[0] as CheckoutOrder), { status: 409 });
    assert.equal(db.checkoutOrder[0].status, 'quoted');
    assert.equal((await fx.sql.query<{state:string}>('SELECT state FROM room_reservation_barriers')).rows[0].state, 'released');
    assert.equal(fetchLog.filter(item => item.method === 'POST').length, 0);
  } finally { await fx.sql.close(); }
});

test('already-cancelled direct readback clears the unresolved marker without another cancellation POST', async () => {
  const fx = await fixture(); try {
    bind(fx.sql);
    await fx.store.begin(input); await fx.store.claimSend(input); await fx.store.finish(input.id, 'confirmed', '123');
    await fx.store.finish(input.id, 'needs_review');
    // Direct markers and checkout markers are the only server-owned external tags.
    await fx.sql.query('UPDATE room_reservation_barriers SET id=$1', ['legacy-reservation:cancelled-test']);
    setFetchHandler(url => {
      if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
      return json({ data: [{ id: 123, roomId: 555, custom1: 'legacy-reservation:cancelled-test', status: 'cancelled' }] });
    });
    await cancelBeds24Booking('123', '555');
    assert.equal((await fx.sql.query<{state:string}>('SELECT state FROM room_reservation_barriers')).rows[0].state, 'released');
    assert.equal(fetchLog.filter(item => item.method === 'POST').length, 0);
  } finally { await fx.sql.close(); }
});
