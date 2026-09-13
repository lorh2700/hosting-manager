import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStayOptions, stayOptionPolicy, stayOptionsNote } from '../lib/payments/stay-options';
import { checkoutPropertyAllowed } from '../lib/payments/config';
import { priceStay, quoteCheckout, startCheckout } from '../lib/payments/checkout';
import { db, resetDb } from './stubs/prisma';
import { json, setFetchHandler, resetFetch, fetchLog } from './helpers/beds24-mock';

beforeEach(() => {
  resetDb(); resetFetch();
  Object.assign(process.env, { CHECKOUT_ENABLED: 'true', CHECKOUT_MODE: 'test', CHECKOUT_PROPERTY_IDS: '',
    CHECKOUT_BEDS24_OFFER_ID: '1', CHECKOUT_SITE_URL: 'http://localhost:3100', CHECKOUT_TERMS: 'Terms',
    CHECKOUT_PRICE_INCLUDES_ALL_FEES: 'true', CRON_SECRET: 'test', TOSS_CLIENT_KEY: 'test_ck_key', TOSS_SECRET_KEY: 'test_sk_key' });
  db.property = [{ id: 'stay-id', slug: 'unwadang', name: '운와당', status: 'active', maxGuests: 6, beds24PropId: '111', beds24RoomId: '555' }];
  setFetchHandler(url => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'beds-token', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1,
      price: url.searchParams.get('numAdults') === '2' ? 400000 : 580000, unitsAvailable: 1 }] }] });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
});
const input = { propertyId: 'stay-id', checkIn: '2027-10-01', checkOut: '2027-10-04', guests: 4, pets: 2,
  name: 'Guest', phone: '1234567', email: 'test@example.com', gateway: 'card' };

test('five approved stays include legacy alias and exclude Jarakheon even if allowlisted', () => {
  for (const slug of ['anon', 'unwadang', 'hwayeonjae', 'dowonjae', 'byulha', 'byeolha']) assert.ok(checkoutPropertyAllowed('stay-id', slug));
  process.env.CHECKOUT_PROPERTY_IDS = 'stay-id';
  assert.equal(checkoutPropertyAllowed('stay-id', 'jarakheon'), false);
  assert.equal(checkoutPropertyAllowed('stay-id', 'unknown'), false);
});

test('three-night quote charges extra guests and dogs once without duplicating Beds24 guest surcharges', async () => {
  const preview = await priceStay(input);
  assert.equal(preview.priceKrw, 560000); // 400,000 base + 60,000 guests + 100,000 dogs.
  assert.equal(preview.stayOptions?.basePriceKrw, 400000);
  const quote = await quoteCheckout({ ...input, priceKrw: 1, stayOptions: { petFeeKrw: 0 } });
  assert.equal(quote.amount, 560000);
  assert.equal(quote.stayOptions?.petFeeKrw, 100000);
  assert.match(stayOptionsNote(quote.stayOptions), /반려견 2마리 100000 KRW/);
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 0);
});

test('pet limits and Dowonjae restrictions are enforced on server', async () => {
  assert.equal(calculateStayOptions('anon', 2, 1, 400000)?.petFeeKrw, 70000);
  assert.equal(calculateStayOptions('anon', 2, 0, 400000)?.extraGuestFeeKrw, 0);
  for (const pets of [-1, 3, 1.5]) await assert.rejects(priceStay({ ...input, pets }));
  db.property[0].slug = 'dowonjae';
  assert.equal(stayOptionPolicy('dowonjae')?.maxPets, 0);
  await assert.rejects(quoteCheckout(input), /반려견 입실/);
  assert.equal((await priceStay({ ...input, pets: 0 })).priceKrw, 460000);
});

test('checkout rechecks the option-inclusive total and refuses a changed rate before holding a room', async () => {
  const quote = await quoteCheckout(input);
  const stored = db.checkoutOrder.find(o => o.id === quote.id)!;
  stored.status = 'quoted';
  stored.priceKrw = 1;
  await assert.rejects(startCheckout(stored as never), /판매 요금이 변경/);
  assert.equal(fetchLog.filter(r => r.method === 'POST').length, 0);
});

test('unchanged option total starts a hold with actual occupancy and dog details', async () => {
  const quote = await quoteCheckout(input);
  const stored = db.checkoutOrder.find(o => o.id === quote.id)!;
  stored.status = 'quoted';
  setFetchHandler((url, init) => {
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1,
      price: url.searchParams.get('numAdults') === '2' ? 400000 : 580000, unitsAvailable: 1 }] }] });
    if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
      const payload = JSON.parse(init.body!)[0];
      assert.equal(payload.numAdult, 4);
      assert.match(payload.notes, /반려견 2마리 100000 KRW/);
      return json([{ success: true, new: { id: 123 } }]);
    }
    if (url.pathname.endsWith('/bookings')) return json({ data: [{ id: 123, roomId: 555,
      custom1: `void-checkout:${quote.id}`, arrival: input.checkIn, departure: input.checkOut, status: 'black' }] });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const started = await startCheckout(stored as never);
  assert.equal(started.status, 'awaiting_payment');
  assert.equal(started.amount, 560000);
});
