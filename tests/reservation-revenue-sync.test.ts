import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, prismaOverrides, resetDb } from './stubs/prisma';
import { json, resetFetch, setFetchHandler, sampleBooking, fetchLog } from './helpers/beds24-mock';
import { invalidateBeds24Token } from '@/lib/beds24';
import { syncBeds24Property } from '@/lib/sync-engine';
import { todayKst, addDaysToDateStr } from '@/lib/dates';

const start = addDaysToDateStr(todayKst(), 1), end = addDaysToDateStr(todayKst(), 3);
const stored: Array<Record<string, unknown>> = [];
beforeEach(() => {
  resetDb(); resetFetch(); invalidateBeds24Token(); stored.length = 0;
  process.env.BEDS24_INVITATIONS_FROM = '2099-01-01T00:00:00Z';
  db.organization = [{ id: 'one', status: 'active', features: { integrations: true } }];
  db.property = [{ id: 'p', name: '숙소', organizationId: 'one', beds24PropId: '111' }];
  prismaOverrides.$queryRaw = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (!parts.join('').includes('reservation_revenue_sources')) return [];
    const rows = JSON.parse(values.at(-1) as string) as Array<Record<string, unknown>>;
    stored.push(...rows); return [{ saved: rows.length }];
  };
});
function remote(rows: Record<string, unknown>[], failCurrency = false) {
  setFetchHandler(url => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'fixture', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return failCurrency ? json({ error: 'private remote detail' }, 503) : json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/bookings')) return json({ data: rows, pages: { nextPageExists: false } });
    throw new Error('Unexpected fixture path');
  });
}

test('Beds24 sync collects original cancellations before calendar pruning and independently refreshes price-only changes', async () => {
  const active = sampleBooking({ arrival: start, departure: end, price: 100000 });
  remote([active, { ...active, id: 124, status: 'cancelled' }]);
  const first = await syncBeds24Property('p', '111');
  assert.equal(first.revenueSourcesUpdated, 2); assert.equal(first.revenueSourceWarning, undefined);
  assert.equal(stored.find(row => row.canonicalKey === 'legacy-beds24:p:124')?.status, 'cancelled');
  assert.equal(db.event.length, 1);
  remote([{ ...active, price: 200000 }]);
  const second = await syncBeds24Property('p', '111');
  assert.equal(second.revenueSourcesUpdated, 1);
  assert.equal(stored.at(-1)?.totalMinor, 200000);
  assert.equal(fetchLog.filter(row => new URL(row.url).pathname.endsWith('/properties')).length, 2);
});

test('financial currency failure still syncs calendar but does not report revenue as updated', async () => {
  remote([sampleBooking({ arrival: start, departure: end, price: 100000 })], true);
  const result = await syncBeds24Property('p', '111');
  assert.equal(result.eventsCreated, 1); assert.equal(result.revenueSourcesUpdated, 0);
  assert.match(result.revenueSourceWarning || '', /통화/); assert.equal(stored.length, 0);
  assert.ok(!JSON.stringify(result).includes('private remote detail'));
});

test('missing revenue migration is a specific warning and does not stop the existing reservation calendar', async () => {
  prismaOverrides.$queryRaw = async () => { throw { code: 'P2010', meta: { code: '42P01' } }; };
  remote([sampleBooking({ arrival: start, departure: end, price: 100000 })]);
  const result = await syncBeds24Property('p', '111');
  assert.equal(result.eventsCreated, 1); assert.equal(result.revenueSourcesUpdated, 0);
  assert.match(result.revenueSourceWarning || '', /DB 업데이트/);
});
