import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { collectBeds24RevenueSources, persistBeds24RevenueSources, prepareBeds24RevenueSource, readRevenueSourceCurrency, type RevenueSourceContext } from '@/lib/reservation-revenue-source';

const context: RevenueSourceContext = { propertyId: 'p', organizationId: 'one', beds24PropertyId: '111', observedAt: new Date('2026-10-11T01:00:00Z') };
const booking = { id: 123, propertyId: 111, arrival: '2026-09-29', departure: '2026-10-03', status: 'confirmed', price: '100000.00', channel: 'Booking.com', modified: '2026-10-10T12:00:00Z' };
const property = async () => ({ data: [{ id: 111, currency: 'KRW' }] });
const parsed = (changes = {}, ctx = context) => prepareBeds24RevenueSource(ctx, { ...booking, ...changes }, 'KRW')!;
async function fixture(migrate = true) {
  const sql = new PGlite();
  await sql.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY); INSERT INTO organizations VALUES('one'),('two');
    CREATE TABLE properties(id TEXT PRIMARY KEY,organization_id TEXT,beds24_prop_id TEXT);
    INSERT INTO properties VALUES('p','one','111'),('foreign','two','222');`);
  if (migrate) await sql.exec(await readFile(new URL('../prisma/migrations/20261011100000_reservation_revenue_sources/migration.sql', import.meta.url), 'utf8'));
  const db = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => (await sql.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows } as unknown as Parameters<typeof persistBeds24RevenueSources>[0];
  return { sql, db, rows: async () => (await sql.query<Record<string, unknown>>('SELECT * FROM reservation_revenue_sources')).rows };
}

test('currency requires exactly one matching property and never assumes KRW', () => {
  assert.equal(readRevenueSourceCurrency({ data: [{ id: 111, currency: 'USD' }] }, '111'), 'USD');
  for (const payload of [null, { success: false, data: [{ id: 111, currency: 'KRW' }] }, { data: [{ id: 222, currency: 'KRW' }] },
    { data: [{ id: 111, currency: 'krw' }] }, { data: [{ id: 111, currency: 'KRW' }, { id: 111, currency: 'KRW' }] }]) assert.equal(readRevenueSourceCurrency(payload, '111'), null);
});

test('stored booking amounts preserve zero, reject rounded or invalid money, and keep foreign currency unconverted', () => {
  assert.equal(parsed().totalMinor, 100000);
  assert.equal(parsed({ price: 0 }).totalMinor, 0);
  assert.equal(parsed({ price: '0.00' }).totalMinor, 0);
  assert.equal(parsed({ price: '1000000000000' }).totalMinor, 1_000_000_000_000);
  for (const price of [null, undefined, '', ' ', '1,000', '-1', '1.01', '1e3', 'Infinity', -1, 0.1, NaN, Infinity, 1_000_000_000_001]) assert.equal(parsed({ price }).totalMinor, null, String(price));
  const foreign = prepareBeds24RevenueSource(context, booking, 'USD')!;
  assert.equal(foreign.currency, 'USD'); assert.equal(foreign.totalMinor, null);
  assert.equal(prepareBeds24RevenueSource(context, booking, null)!.totalMinor, null);
});

test('source snapshots normalize statuses, validate dates and property identity, and discard guest data', () => {
  for (const [status, expected] of [['new','confirmed'], ['confirmed','confirmed'], ['cancelled','cancelled'], ['canceled','cancelled'], ['no_show','noshow'], ['no-show','noshow'], ['noshow','noshow'], ['black','pending'], ['request','pending'], ['unexpected','pending']]) assert.equal(parsed({ status }).status, expected);
  for (const changes of [{ id: 0 }, { propertyId: 222 }, { arrival: '2026-02-30' }, { departure: '2026-09-29' }, { departure: '2026-09-28' }, { arrival: 'invalid' }]) assert.equal(prepareBeds24RevenueSource(context, { ...booking, ...changes }, 'KRW'), null);
  const row = parsed({ firstName: 'private-name', notes: 'private-note', email: 'private-email', price: 0 });
  assert.equal(row.canonicalKey, 'legacy-beds24:p:123');
  assert.ok(!JSON.stringify(row).includes('private-'));
  assert.equal(parsed({ modified: '2026-10-10T12:00:00' }).sourceModifiedAt, null);
});

test('content hashes are stable across observations but change with price, dates or status', () => {
  const row = parsed();
  assert.match(row.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(parsed({}, { ...context, observedAt: new Date('2026-10-12T00:00:00Z') }).sourceHash, row.sourceHash);
  assert.equal(parsed({ modified: '2026-10-11T00:00:00Z', firstName: 'other' }).sourceHash, row.sourceHash);
  for (const changes of [{ price: 200000 }, { arrival: '2026-09-28' }, { departure: '2026-10-04' }, { status: 'cancelled' }, { channel: 'Airbnb' }]) assert.notEqual(parsed(changes).sourceHash, row.sourceHash);
});

test('SQL upserts amount-only changes and cancellation tombstones without duplication', async () => {
  const fx = await fixture();
  try {
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed()]), 1);
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed({ price: 300000, modified: '2026-10-11T00:00:00Z' })]), 1);
    let rows = await fx.rows(); assert.equal(rows.length, 1); assert.equal(Number(rows[0].total_minor), 300000);
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed({ status: 'cancelled', modified: '2026-10-11T00:01:00Z' })]), 1);
    rows = await fx.rows(); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'cancelled');
  } finally { await fx.sql.close(); }
});

test('older provider versions and delayed observations cannot overwrite newer monetary snapshots', async () => {
  const fx = await fixture();
  try {
    const recent = { ...context, observedAt: new Date('2026-10-11T02:00:00Z') };
    await persistBeds24RevenueSources(fx.db, recent, [parsed({ price: 400000, modified: '2026-10-11T01:00:00Z' }, recent)]);
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed()]), 0);
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed({ modified: '2026-10-11T01:00:00Z' })]), 0);
    assert.equal(await persistBeds24RevenueSources(fx.db, recent, [parsed({ modified: null }, recent)]), 0);
    assert.equal(Number((await fx.rows())[0].total_minor), 400000);
    await fx.sql.exec('DELETE FROM reservation_revenue_sources');
    await persistBeds24RevenueSources(fx.db, recent, [parsed({ price: 500000, modified: null }, recent)]);
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed({ modified: null })]), 0);
    assert.equal(Number((await fx.rows())[0].total_minor), 500000);
  } finally { await fx.sql.close(); }
});

test('property moves and connection changes cannot reassign existing revenue or insert a stale in-flight response', async () => {
  const fx = await fixture();
  try {
    await persistBeds24RevenueSources(fx.db, context, [parsed()]);
    await fx.sql.exec("UPDATE properties SET organization_id='two' WHERE id='p'");
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed({ id: 124 })]), 0);
    assert.equal(await persistBeds24RevenueSources(fx.db, { ...context, organizationId: 'two' }, [parsed({ price: 300000 })]), 0);
    let rows = await fx.rows(); assert.equal(rows.length, 1); assert.equal(rows[0].organization_id, 'one');
    assert.equal(Number(rows[0].total_minor), 100000);
    await fx.sql.exec("UPDATE properties SET organization_id='one',beds24_prop_id='333' WHERE id='p'");
    assert.equal(await persistBeds24RevenueSources(fx.db, context, [parsed({ id: 124 })]), 0);
    rows = await fx.rows(); assert.equal(rows.length, 1);
  } finally { await fx.sql.close(); }
});

test('collecting original bookings retains cancelled and no-show rows, rejects ambiguous duplicates and never parses description', async () => {
  const fx = await fixture();
  try {
    const result = await collectBeds24RevenueSources({ db: fx.db, context, readProperty: property, bookings: [booking,
      { ...booking, id: 124, status: 'cancelled' }, { ...booking, id: 125, status: 'noshow' },
      { ...booking, id: 126, price: undefined, description: '금액: ₩900,000' },
      { ...booking, id: 127 }, { ...booking, id: 127, price: 900000 }] });
    assert.equal(result.saved, 4); assert.equal(result.skipped, 1); assert.ok(result.warning);
    const rows = await fx.rows();
    assert.equal(rows.find(row => row.canonical_key === 'legacy-beds24:p:124')?.status, 'cancelled');
    assert.equal(rows.find(row => row.canonical_key === 'legacy-beds24:p:125')?.status, 'noshow');
    assert.equal(rows.find(row => row.canonical_key === 'legacy-beds24:p:126')?.total_minor, null);
  } finally { await fx.sql.close(); }
});

test('failed currency reads preserve the old observation timestamp and return an explicit warning', async () => {
  const fx = await fixture();
  try {
    await persistBeds24RevenueSources(fx.db, context, [parsed()]);
    const before = await fx.rows();
    const result = await collectBeds24RevenueSources({ db: fx.db, context: { ...context, observedAt: new Date('2026-10-12T00:00:00Z') }, bookings: [{ ...booking, price: 900000 }], readProperty: async () => { throw new Error('sensitive upstream details'); } });
    assert.equal(result.saved, 0); assert.equal(result.skipped, 1); assert.ok(result.warning);
    assert.ok(!result.warning!.includes('sensitive')); assert.deepEqual(await fx.rows(), before);
  } finally { await fx.sql.close(); }
});

test('missing migration is reported without throwing or exposing database error details', async () => {
  const fx = await fixture(false);
  try {
    const result = await collectBeds24RevenueSources({ db: fx.db, context, bookings: [booking], readProperty: property });
    assert.equal(result.saved, 0); assert.match(result.warning || '', /DB 업데이트/);
  } finally { await fx.sql.close(); }
});
