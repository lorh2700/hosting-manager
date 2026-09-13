import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStaySearch, staySearchQuery } from '../lib/stay-search';
import { POST } from '../app/api/public/stay-search/route';
import { GET } from '../app/api/public/properties/route';
import { db, resetDb } from './stubs/prisma';
import { callRoute, makeRequest, json, setFetchHandler, resetFetch, fetchLog } from './helpers/beds24-mock';

const criteria = { checkIn: '2027-10-01', checkOut: '2027-10-04', guests: 4, pets: 2 };
beforeEach(() => {
  resetDb(); resetFetch();
  process.env.CHECKOUT_BEDS24_OFFER_ID = '1';
  process.env.CHECKOUT_PRICE_INCLUDES_ALL_FEES = 'true';
  db.property = [{ id: 'stay-id', slug: 'unwadang', name: '운와당', status: 'active', maxGuests: 6, basePrice: 150000, beds24PropId: '111', beds24RoomId: '555' }];
  setFetchHandler(url => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'beds-token', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 400000, unitsAvailable: 1 }] }] });
    throw new Error('Unexpected request');
  });
});
test('search validates real dates, stay length and occupancy; conditions round-trip to detail URL', () => {
  assert.deepEqual(parseStaySearch(Object.fromEntries(new URLSearchParams(staySearchQuery(criteria)))), criteria);
  for (const value of [null, {}, { ...criteria, checkIn: '2027-02-30' }, { ...criteria, checkOut: criteria.checkIn }, { ...criteria, guests: 0 }, { ...criteria, pets: 3 }, { ...criteria, checkOut: '2027-12-01' }]) assert.equal(parseStaySearch(value), null);
});
test('search quotes the whole stay including per-stay extras without creating a booking', async () => {
  const response = await callRoute(POST, makeRequest(criteria));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results, [{ slug: 'unwadang', status: 'available', priceKrw: 560000, nights: 3, includesAllFees: true }]);
  assert.ok(!fetchLog.some(entry => entry.method === 'POST'));
  assert.equal(db.checkoutOrder?.length ?? 0, 0);
});
test('capacity and pet restrictions are excluded before calling Beds24', async () => {
  db.property.push({ ...db.property[0], id: 'dowon-id', slug: 'dowonjae' });
  db.property[0].maxGuests = 2;
  const response = await callRoute(POST, makeRequest(criteria));
  assert.equal(response.status, 200);
  assert.equal(response.body.results.length, 2);
  assert.ok(response.body.results.every((result: { status: string }) => result.status === 'unavailable'));
  assert.equal(fetchLog.length, 0);
});
test('configuration failure is not presented as sold out', async () => {
  process.env.CHECKOUT_BEDS24_OFFER_ID = '';
  const response = await callRoute(POST, makeRequest(criteria));
  assert.equal(response.body.results[0].status, 'error');
});
test('public cards expose configured base rate and capacity without access credentials', async () => {
  db.property[0].doorPassword = 'private';
  const response = await callRoute(GET, makeRequest({}));
  assert.equal(response.body[0].basePrice, 150000);
  assert.equal(response.body[0].maxGuests, 6);
  assert.equal(response.body[0].maxPets, 2);
  assert.equal(response.body[0].doorPassword, undefined);
});
