import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, calls, prisma, prismaOverrides } from './stubs/prisma';
import { json, setFetchHandler, resetFetch, fetchLog, callRoute } from './helpers/beds24-mock';
import { listStayTours, resolveTourSelections, readTourSelections, submitStayTourInquiry } from '../lib/payments/tour-selections';
import { quoteCheckout, startCheckout, reconcileCheckout, publicOrder } from '../lib/payments/checkout';
import { POST as inquiryPost } from '../app/api/public/stay-tours/route';
import { POST as checkoutPost } from '../app/api/public/checkout/route';
import { tourSelectionsForSubmission } from '../app/(public)/book/[id]/tour-selection';
import { POST as createTour } from '../app/api/tours/route';
import { actAsAdmin, actAsBusinessAdmin } from './stubs/auth';
import type { CheckoutOrder } from '../generated/prisma/client';

const stay = { propertyId: 'stay-id', checkIn: '2028-10-01', checkOut: '2028-10-04', guests: 2, pets: 0,
  name: 'Guest', phone: '01012345678', email: 'guest@example.com', gateway: 'card' };
const selection = { tourId: 'tour-1', requestedDate: '2028-10-02', requestedTime: '14:00', guests: 2, language: 'ko' as const };
const standalone = { propertyId: stay.propertyId, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests,
  name: stay.name, phone: stay.phone, email: stay.email, tourSelections: [selection], idempotencyKey: 'ad7582ce-7272-4018-b2fc-ebcd85446bd8' };
let paymentStatus: string;
let remoteStatus: string;
let orderId: string;
let holdUnknown: boolean;

beforeEach(() => {
  resetDb(); resetFetch(); actAsAdmin(); paymentStatus = 'IN_PROGRESS'; remoteStatus = 'black'; orderId = ''; holdUnknown = false;
  Object.assign(process.env, { CHECKOUT_ENABLED: 'true', CHECKOUT_MODE: 'test', CHECKOUT_PROPERTY_IDS: '',
    CHECKOUT_BEDS24_OFFER_ID: '1', CHECKOUT_SITE_URL: 'http://localhost:3100', CHECKOUT_TERMS: 'Fallback terms',
    CHECKOUT_PRICE_INCLUDES_ALL_FEES: 'true', CRON_SECRET: 'test', TOSS_CLIENT_KEY: 'test_ck_key', TOSS_SECRET_KEY: 'test_sk_key' });
  db.property = [{ id: 'stay-id', slug: 'unwadang', name: '운와당', status: 'active', maxGuests: 6,
    ownerId: 'owner-1', organizationId: 'org-1', featureOverrides: {},
    organization: { status: 'active', features: {} }, beds24PropId: '111', beds24RoomId: '555' }];
  db.tour = [{ id: 'tour-1', organizationId: null, ownerId: 'owner-1', owner: { id: 'owner-1', organizationId: 'org-1' },
    title: '북촌 산책', slug: 'bukchon', description: null, meetingPoint: '안국역', durationMin: 60, basePrice: 30000,
    maxGroupSize: 4, images: [], isActive: true, durationOptions: [], ticketTiers: [] }];
  setFetchHandler((url, init) => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'beds-token', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 400000, unitsAvailable: 1 }] }] });
    if (url.hostname === 'api.tosspayments.com') {
      if (url.pathname.endsWith('/confirm')) paymentStatus = 'DONE';
      if (url.pathname.endsWith('/cancel')) paymentStatus = 'CANCELED';
      return json({ orderId, currency: 'KRW', totalAmount: 400000, paymentKey: 'pk-tour', status: paymentStatus });
    }
    if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
      const payload = JSON.parse(init.body!)[0];
      if (!payload.id && holdUnknown) throw new Error('Unknown hold response');
      remoteStatus = payload.status;
      return json([{ success: true, new: { id: 123 } }]);
    }
    if (url.pathname.endsWith('/bookings')) return json({ data: holdUnknown ? [] : [{ id: 123, roomId: 555,
      custom1: `void-checkout:${orderId}`, arrival: stay.checkIn, departure: stay.checkOut, status: remoteStatus }] });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
});

const storedOrder = () => db.checkoutOrder.find(order => order.id === orderId) as CheckoutOrder;
async function quote(tourSelections: unknown = [selection]) {
  const result = await quoteCheckout({ ...stay, tourSelections });
  orderId = result.id;
  db.checkoutOrder[0].status = 'quoted';
  db.checkoutOrder[0].createdAt = new Date();
  return result;
}

test('stay tour catalog is scoped to the property tenant and excludes private owner fields', async () => {
  db.tour.push({ ...db.tour[0], id: 'tour-foreign', ownerId: 'other', owner: { id: 'other', organizationId: 'org-2' } });
  assert.deepEqual((await listStayTours('stay-id')).map(tour => tour.id), ['tour-1']);
  assert.ok(!('owner' in (await listStayTours('stay-id'))[0]));
  assert.ok(!('organizationId' in (await listStayTours('stay-id'))[0]));
  await assert.rejects(resolveTourSelections([{ ...selection, tourId: 'tour-foreign' }], stay), /신청할 수 없는/);
  db.property[0].organization.features = { tours: false };
  assert.deepEqual(await listStayTours('stay-id'), []);
  await assert.rejects(resolveTourSelections([selection], stay), /신청할 수 없습니다/);
});

test('explicit tour organization takes precedence and unassigned global-owner tours stay hidden', async () => {
  db.tour.push({ ...db.tour[0], id: 'linked-global', organizationId: 'org-1', ownerId: 'global-owner', owner: { id: 'global-owner', organizationId: null } });
  db.tour.push({ ...db.tour[0], id: 'unassigned-global', organizationId: null, ownerId: 'global-owner', owner: { id: 'global-owner', organizationId: null } });
  db.tour.push({ ...db.tour[0], id: 'explicit-other', organizationId: 'org-2' });
  assert.deepEqual((await listStayTours('stay-id')).map(tour => tour.id).sort(), ['linked-global', 'tour-1']);
  assert.equal((await resolveTourSelections([{ ...selection, tourId: 'linked-global' }], stay))[0].tourId, 'linked-global');
  for (const tourId of ['unassigned-global', 'explicit-other']) await assert.rejects(resolveTourSelections([{ ...selection, tourId }], stay));
  db.property[0].organizationId = null;
  db.property[0].ownerId = 'global-owner';
  assert.deepEqual((await listStayTours('stay-id')).map(tour => tour.id), ['unassigned-global']);
});

test('new tours use the authenticated business organization and ignore a supplied organization', async () => {
  actAsBusinessAdmin('org-1');
  const request = new Request('http://localhost/api/tours', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test tour', slug: 'new-tour', organizationId: 'org-foreign' }) });
  assert.equal((await callRoute(createTour, request)).status, 201);
  const added = db.tour.find(tour => tour.slug === 'new-tour')!;
  assert.equal(added.organizationId, 'org-1');
  assert.equal(added.ownerId, 'business-admin-1');
  actAsAdmin();
  const legacy = new Request('http://localhost/api/tours', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Global tour', slug: 'global-tour', organizationId: 'org-foreign' }) });
  assert.equal((await callRoute(createTour, legacy)).status, 201);
  assert.equal(db.tour.find(tour => tour.slug === 'global-tour')!.organizationId, null);
});

test('legacy properties can select only tours owned by the same unscoped owner', async () => {
  db.property[0].organizationId = null;
  db.property[0].organization = null;
  assert.deepEqual(await listStayTours('stay-id'), []);
  db.tour[0].owner.organizationId = null;
  assert.equal((await listStayTours('stay-id')).length, 1);
  db.tour[0].ownerId = 'other';
  assert.deepEqual(await listStayTours('stay-id'), []);
});

test('stay bounds, future times, participant limits and duplicate tours are validated', async () => {
  for (const change of [{ requestedDate: '2028-09-30' }, { requestedDate: '2028-10-05' }, { requestedDate: '2028-02-30' },
    { requestedTime: '24:00' }, { guests: 3 }, { guests: 0 }, { totalPrice: 1 }, { language: 'unknown' }]) {
    await assert.rejects(resolveTourSelections([{ ...selection, ...change }], stay));
  }
  await assert.rejects(resolveTourSelections([selection, selection], stay));
  assert.equal((await resolveTourSelections([{ ...selection, requestedDate: stay.checkOut }], stay)).length, 1);
  db.tour[0].isActive = false;
  await assert.rejects(resolveTourSelections([selection], stay));
});

test('ticket and course snapshots use server prices, accept free tickets and reject foreign or duplicate tiers', async () => {
  db.tour[0].durationOptions = [{ id: 'course-1', label: '짧은 코스', durationMin: 45, price: 40000 }];
  db.tour[0].ticketTiers = [{ id: 'adult', label: '성인', price: 30000, notes: null }, { id: 'infant', label: '영유아', price: 0, notes: null }];
  const input = { ...selection, durationOptionId: 'course-1', tickets: [{ tierId: 'adult', count: 1 }, { tierId: 'infant', count: 1 }] };
  const [snapshot] = await resolveTourSelections([input], stay);
  assert.equal(snapshot.totalPrice, 30000);
  assert.equal(snapshot.durationMin, 45);
  assert.equal(snapshot.tickets[1].unitPrice, 0);
  for (const change of [{ durationOptionId: 'foreign' }, { durationOptionId: undefined },
    { tickets: [{ tierId: 'adult', count: 1 }] }, { tickets: [{ tierId: 'adult', count: 1 }, { tierId: 'adult', count: 1 }] },
    { tickets: [{ tierId: 'foreign', count: 2 }] }]) await assert.rejects(resolveTourSelections([{ ...input, ...change }], stay));
});

test('the UI default adult-two child-zero selection is accepted by both checkout and standalone inquiry APIs', async () => {
  db.tour[0].ticketTiers = [{ id: 'adult', label: '성인', price: 30000, notes: null }, { id: 'child', label: '어린이', price: 15000, notes: null }];
  const editable = [{ ...selection, tickets: [{ tierId: 'adult', count: 2 }, { tierId: 'child', count: 0 }] }];
  const tourSelections = tourSelectionsForSubmission(editable);
  const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': 'default-ticket-integration' }, body: JSON.stringify(body),
  });
  const quoteResult = await callRoute(checkoutPost, request('/api/public/checkout', { ...stay, action: 'quote', tourSelections }));
  assert.equal(quoteResult.status, 200);
  assert.equal(quoteResult.body.amount, 400000);
  assert.equal(quoteResult.body.tourSelections[0].totalPrice, 60000);
  assert.deepEqual(quoteResult.body.tourSelections[0].tickets, [{ tierId: 'adult', label: '성인', count: 2, unitPrice: 30000 }]);
  assert.equal(db.tourBooking?.length ?? 0, 0);
  const inquiryResult = await callRoute(inquiryPost, request('/api/public/stay-tours', { ...standalone, tourSelections }));
  assert.equal(inquiryResult.status, 201);
  assert.equal(inquiryResult.body.inquiries[0].totalPrice, 60000);
  assert.deepEqual(db.tourBooking[0].tickets, quoteResult.body.tourSelections[0].tickets);
  assert.equal(db.tourBooking[0].guests, 2);
  assert.equal(db.booking?.length ?? 0, 0);
  assert.equal(editable[0].tickets[1].count, 0);
});

test('optional tours are snapshotted without increasing the lodging charge or reserving tour inventory', async () => {
  const result = await quote();
  assert.equal(result.priceKrw, 400000);
  assert.equal(result.amount, 400000);
  assert.equal(result.tourSelections[0].totalPrice, 60000);
  assert.equal(result.tourSelections[0].requestStatus, 'selected');
  assert.equal(db.tourBooking?.length ?? 0, 0);
  assert.ok(!calls.some(call => call.startsWith('tourSchedule.')));
  db.tour[0].basePrice = 90000;
  assert.equal(publicOrder(storedOrder()).tourSelections[0].totalPrice, 60000);
});

test('refund terms are copied at quote and old orders keep their accepted terms', async () => {
  db.property[0].refundPolicy = { tiers: [{ minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 8, refundPercent: 25 },
    { minDaysBefore: 15, refundPercent: 50 }, { minDaysBefore: 22, refundPercent: 75 }, { minDaysBefore: 30, refundPercent: 100 }] };
  const result = await quote([]);
  assert.match(result.terms, /100%/);
  assert.match(result.terms, /25%/);
  const original = result.terms;
  db.property[0].refundPolicy = null;
  process.env.CHECKOUT_TERMS = 'Changed fallback';
  assert.equal(publicOrder(storedOrder()).terms, original);
  const fallback = await quote([]);
  assert.equal(fallback.terms, 'Changed fallback');
});

test('only a verified paid stay creates linked pending tour inquiries and repeated reconciliation does not reset them', async () => {
  await quote();
  await startCheckout(storedOrder());
  await reconcileCheckout(orderId);
  assert.equal(db.tourBooking?.length ?? 0, 0);
  await reconcileCheckout(orderId, true);
  assert.equal(storedOrder().status, 'confirmed');
  assert.equal(db.tourBooking.length, 1);
  const inquiry = db.tourBooking[0];
  assert.equal(inquiry.status, 'pending');
  assert.equal(inquiry.source, 'stay_checkout');
  assert.equal(inquiry.bookingId, storedOrder().bookingId);
  assert.equal(inquiry.totalPrice, 60000);
  assert.ok(!inquiry.scheduleId);
  assert.match(inquiry.message, /숙박 결제금액에 포함되지/);
  assert.equal(readTourSelections(storedOrder().tourSelections)[0].inquiryId, inquiry.id);
  inquiry.status = 'confirmed';
  await reconcileCheckout(orderId);
  assert.equal(db.tourBooking.length, 1);
  assert.equal(inquiry.status, 'confirmed');
  assert.ok(!calls.some(call => call.startsWith('tourSchedule.')));
});

test('unknown Beds24 hold results never create tour inquiries', async () => {
  await quote(); holdUnknown = true;
  await assert.rejects(startCheckout(storedOrder()));
  await reconcileCheckout(orderId);
  assert.equal(storedOrder().status, 'holding');
  assert.equal(db.tourBooking?.length ?? 0, 0);
});

test('an interrupted final database save retries without a second lodging charge or duplicate tour request', async () => {
  await quote();
  await startCheckout(storedOrder());
  const base = prisma.tourBooking;
  prismaOverrides.tourBooking = { ...base, upsert: async () => { throw new Error('Database temporarily unavailable'); } };
  await assert.rejects(reconcileCheckout(orderId, true));
  assert.equal(paymentStatus, 'DONE');
  assert.equal(storedOrder().status, 'fulfilling');
  assert.equal(db.booking?.length ?? 0, 0);
  assert.equal(db.tourBooking?.length ?? 0, 0);
  delete prismaOverrides.tourBooking;
  await reconcileCheckout(orderId);
  await reconcileCheckout(orderId);
  assert.equal(storedOrder().status, 'confirmed');
  assert.equal(db.booking.length, 1);
  assert.equal(db.tourBooking.length, 1);
});

test('removed or reassigned tour after payment leaves the paid stay confirmed and records an unavailable inquiry', async () => {
  await quote();
  await startCheckout(storedOrder());
  db.tour[0].owner.organizationId = 'org-2';
  await reconcileCheckout(orderId, true);
  assert.equal(storedOrder().status, 'confirmed');
  assert.equal(db.tourBooking?.length ?? 0, 0);
  assert.equal(readTourSelections(storedOrder().tourSelections)[0].requestStatus, 'unavailable');
});

test('standalone inquiries work with checkout disabled and never reserve or charge a stay', async () => {
  process.env.CHECKOUT_ENABLED = 'false';
  const result = await submitStayTourInquiry(standalone);
  assert.equal(result.lodgingBooked, false);
  assert.equal(result.replayed, false);
  assert.equal(result.inquiries[0].totalPrice, 60000);
  assert.equal(result.inquiries[0].status, 'pending');
  assert.equal(db.tourBooking[0].source, 'stay_inquiry');
  assert.equal(db.tourBooking[0].bookingId ?? null, null);
  assert.match(db.tourBooking[0].message, /숙박은 확정되지 않았으며/);
  assert.equal(fetchLog.length, 0);
  assert.equal(db.booking?.length ?? 0, 0);
  assert.equal(db.checkoutOrder?.length ?? 0, 0);
  assert.ok(!calls.some(call => call.startsWith('tourSchedule.')));
});

test('same request replays original prices and current inquiry status after catalog changes', async () => {
  const original = await submitStayTourInquiry(standalone);
  db.tour[0].basePrice = 90000;
  db.tour[0].isActive = false;
  db.tourBooking[0].status = 'forwarded';
  const replay = await submitStayTourInquiry(standalone);
  assert.equal(replay.replayed, true);
  assert.equal(replay.inquiries[0].id, original.inquiries[0].id);
  assert.equal(replay.inquiries[0].totalPrice, 60000);
  assert.equal(replay.inquiries[0].status, 'forwarded');
  assert.equal(db.tourBooking.length, 1);
  assert.ok(!('phone' in replay.inquiries[0]));
});

test('reusing a request key with changed contact, dates or selections returns a conflict', async () => {
  await submitStayTourInquiry(standalone);
  for (const changes of [{ phone: '01099999999' }, { checkOut: '2028-10-05' },
    { tourSelections: [{ ...selection, requestedTime: '15:00' }] }]) {
    await assert.rejects(submitStayTourInquiry({ ...standalone, ...changes }), error => (error as { status?: number }).status === 409);
  }
  assert.equal(db.tourBooking.length, 1);
});

test('simultaneous same-key requests create one inquiry and conflicting batches cannot bypass the key with different tours', async () => {
  const results = await Promise.all([submitStayTourInquiry(standalone), submitStayTourInquiry(standalone)]);
  assert.equal(results[0].inquiries[0].id, results[1].inquiries[0].id);
  assert.equal(db.tourBooking.length, 1);
  db.tour.push({ ...db.tour[0], id: 'tour-2' });
  const key = 'bd7582ce-7272-4018-b2fc-ebcd85446bd8';
  const conflicting = await Promise.allSettled([
    submitStayTourInquiry({ ...standalone, idempotencyKey: key }),
    submitStayTourInquiry({ ...standalone, idempotencyKey: key, tourSelections: [{ ...selection, tourId: 'tour-2' }] }),
  ]);
  assert.equal(conflicting.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(conflicting.filter(result => result.status === 'rejected').length, 1);
  assert.equal(db.tourBooking.length, 2);
});

test('standalone batches are atomic and a failed batch can be retried without partial inquiries', async () => {
  db.tour.push({ ...db.tour[0], id: 'tour-2' });
  const input = { ...standalone, tourSelections: [selection, { ...selection, tourId: 'tour-2' }] };
  const base = prisma.tourBooking;
  let count = 0;
  prismaOverrides.tourBooking = { ...base, create: async (args: unknown) => {
    if (++count === 2) throw new Error('Database temporarily unavailable');
    return base.create(args);
  } };
  await assert.rejects(submitStayTourInquiry(input));
  assert.equal(db.tourBooking?.length ?? 0, 0);
  delete prismaOverrides.tourBooking;
  const result = await submitStayTourInquiry(input);
  assert.equal(result.inquiries.length, 2);
  assert.equal(db.tourBooking.length, 2);
  const replay = await submitStayTourInquiry({ ...input, tourSelections: [...input.tourSelections].reverse() });
  assert.equal(replay.replayed, true);
  assert.equal(db.tourBooking.length, 2);
});

test('standalone contact, dates, capacity, tenant and extra fields are validated before any creation', async () => {
  for (const changes of [{ name: '' }, { phone: 'abc' }, { email: 'invalid' }, { idempotencyKey: 'short' },
    { checkOut: stay.checkIn }, { checkOut: '2029-10-01' }, { guests: 20 }, { tourSelections: [] }, { bookingId: 'another-booking' },
    { tourSelections: [{ ...selection, tourId: 'foreign' }] }]) {
    await assert.rejects(submitStayTourInquiry({ ...standalone, ...changes }));
  }
  assert.equal(db.tourBooking?.length ?? 0, 0);
  db.tour[0].basePrice = 0;
  const free = await submitStayTourInquiry({ ...standalone, email: '' });
  assert.equal(free.inquiries[0].totalPrice, 0);
});

test('standalone HTTP endpoint returns 201/200 and rejects oversized bodies and excessive requests', async () => {
  const request = (body: unknown, ip: string) => new Request('http://localhost/api/public/stay-tours', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
  });
  const created = await inquiryPost(request(standalone, 'tour-route-success'), { params: Promise.resolve({}) });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('Cache-Control'), 'no-store');
  assert.equal((await callRoute(inquiryPost, request(standalone, 'tour-route-success'))).status, 200);
  assert.equal((await callRoute(inquiryPost, request({ ...standalone, extra: 'a'.repeat(17_000) }, 'tour-route-large'))).status, 413);
  for (let index = 0; index < 10; index++) await callRoute(inquiryPost, request({}, 'tour-route-limit'));
  assert.equal((await callRoute(inquiryPost, request({}, 'tour-route-limit'))).status, 429);
});
