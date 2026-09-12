import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckoutOrder } from '../generated/prisma/client';
import { db, resetDb } from './stubs/prisma';
import { json, setFetchHandler, resetFetch, fetchLog } from './helpers/beds24-mock';
import { startCheckout, reconcileCheckout, requestRefund, priceStay, quoteCheckout } from '../lib/payments/checkout';
import { checkoutMarker } from '../lib/payments/beds';
import { getPayPalPayment } from '../lib/payments/paypal';

const id = 'e1a6bb45-d76c-4322-b270-76934162bf35';
const pid = '02b10660-965d-4714-a0fe-55dc90956ea3';
const order = (over: Partial<CheckoutOrder> = {}): CheckoutOrder => ({ id, propertyId: pid, roomId: 555, offerId: 1,
  tokenHash: 'test', propertyName: 'Test stay', checkIn: '2027-10-01', checkOut: '2027-10-03', guests: 2,
  name: 'Guest', email: 'test@example.com', phone: '+12025550100', gateway: 'paypal', mode: 'test', currency: 'USD',
  amountMinor: 25000, priceKrw: 350000, fxRate: '1400', terms: 'Terms', termsAcceptedAt: new Date(), status: 'awaiting_payment',
  beds24Id: '123', paymentKey: 'PP-ORDER', paypalRefundId: null, paypalRefundRequestedAt: null, bookingId: null,
  expiresAt: new Date(Date.now() + 900000), leaseUntil: null, lastError: null, createdAt: new Date(), updatedAt: new Date(), ...over });
let remoteStatus: string, ppStatus: string, captureStatus: string, refundStatus: string;
let captureCalls: number, refundCalls: number, createCalls: number, bedsCreates: number;
let lostCapture: boolean, lostCreate: boolean, lostRefund: boolean, outage: boolean;
let price: number, amount: string, customId: string, maliciousLink: boolean, expectedAdults: number;
const current = () => db.checkoutOrder[0] as CheckoutOrder;
const remote = () => ({ id: 'PP-ORDER', intent: 'CAPTURE', status: ppStatus,
  purchase_units: [{ custom_id: customId, invoice_id: id, amount: { currency_code: 'USD', value: amount },
    payments: { captures: captureStatus ? [{ id: 'PP-CAPTURE', status: captureStatus, amount: { currency_code: 'USD', value: amount } }] : [] } }],
  links: [{ rel: 'payer-action', href: maliciousLink ? 'https://evil.example/pay' : 'https://www.sandbox.paypal.com/checkoutnow?token=PP-ORDER' }],
});
beforeEach(() => {
  resetDb(); resetFetch(); remoteStatus = 'black'; ppStatus = 'APPROVED'; captureStatus = ''; refundStatus = 'COMPLETED';
  captureCalls = refundCalls = createCalls = bedsCreates = 0; lostCapture = lostCreate = lostRefund = outage = maliciousLink = false;
  price = 350000; amount = '250.00'; customId = id; expectedAdults = 2;
  Object.assign(process.env, { CHECKOUT_ENABLED: 'true', CHECKOUT_MODE: 'test', CHECKOUT_PROPERTY_IDS: pid,
    CHECKOUT_BEDS24_OFFER_ID: '1', CHECKOUT_SITE_URL: 'http://localhost:3100', CHECKOUT_TERMS: 'Terms', CHECKOUT_KRW_PER_USD: '1400',
    CHECKOUT_PRICE_INCLUDES_ALL_FEES: 'true', CRON_SECRET: 'cron-test', PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'dummy-client', PAYPAL_CLIENT_SECRET: 'dummy-secret' });
  db.checkoutOrder = [order()];
  db.property = [{ id: pid, name: 'Test stay', status: 'active', maxGuests: 4, beds24PropId: '111', beds24RoomId: '555' }];
  setFetchHandler((url, init) => {
    if (url.hostname.includes('paypal.com')) {
      assert.equal(url.hostname, 'api-m.sandbox.paypal.com');
      if (outage) throw new Error('offline');
      if (url.pathname === '/v1/oauth2/token') return json({ access_token: 'dummy-token', token_type: 'Bearer' });
      if (init.method === 'POST') assert.ok(init.headers['PayPal-Request-Id'].length <= 38);
      if (url.pathname === '/v2/checkout/orders' && init.method === 'POST') {
        createCalls++; const payload = JSON.parse(init.body!);
        assert.equal(payload.purchase_units[0].amount.value, '250.00');
        assert.equal(payload.purchase_units[0].custom_id, id);
        if (lostCreate) throw new Error('create response lost');
        ppStatus = 'PAYER_ACTION_REQUIRED'; return json(remote());
      }
      if (url.pathname.endsWith('/capture')) { captureCalls++; captureStatus = 'COMPLETED'; ppStatus = 'COMPLETED'; if (lostCapture) throw new Error('capture response lost'); return json(remote()); }
      if (url.pathname.endsWith('/refund')) {
        refundCalls++; if (refundStatus === 'COMPLETED') captureStatus = 'REFUNDED';
        if (lostRefund) throw new Error('refund response lost');
        return json({ id: 'PP-REFUND', status: refundStatus, amount: { currency_code: 'USD', value: amount } });
      }
      if (url.pathname.includes('/refunds/')) return json({ id: 'PP-REFUND', status: refundStatus, amount: { currency_code: 'USD', value: amount } });
      if (url.pathname.includes('/payments/captures/')) return json({ id: 'PP-CAPTURE', status: captureStatus, amount: { currency_code: 'USD', value: amount } });
      if (url.pathname === '/v2/checkout/orders/PP-ORDER') return json(remote());
    }
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'beds-token', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) {
      assert.equal(url.searchParams.get('numAdults'), String(expectedAdults));
      assert.equal(url.searchParams.get('arrival'), '2027-10-01');
      return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price, unitsAvailable: 1 }] }] });
    }
    if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
      const payload = JSON.parse(init.body!)[0]; if (!payload.id) { bedsCreates++; assert.equal(payload.actions.checkAvailability, true); }
      remoteStatus = payload.status; return json([{ success: true, new: { id: 123 } }]);
    }
    if (url.pathname.endsWith('/bookings')) return json({ data: [{ id: 123, roomId: 555, custom1: checkoutMarker(id), arrival: '2027-10-01', departure: '2027-10-03', status: remoteStatus }] });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
});

test('Beds24 prices drive quote; client amount cannot change the charged amount', async () => {
  const input = { propertyId: pid, checkIn: '2027-10-01', checkOut: '2027-10-03', guests: 2, name: 'Guest', email: 'test@example.com', phone: '1234567', gateway: 'paypal', priceKrw: 1, amountMinor: 1 };
  assert.equal((await priceStay(input)).priceKrw, 350000);
  const quote = await quoteCheckout(input); assert.equal(quote.amount, 250); assert.equal(quote.priceKrw, 350000);
  assert.equal(createCalls, 0); assert.equal(bedsCreates, 0);
});
test('legacy Firestore property IDs work for price and checkout quotes', async () => {
  const legacyId = 'oKWKVQqLy7uENyHUwljr';
  db.property[0].id = legacyId;
  process.env.CHECKOUT_PROPERTY_IDS = legacyId;
  const input = { propertyId: legacyId, checkIn: '2027-10-01', checkOut: '2027-10-03', guests: 2,
    name: 'Guest', email: 'test@example.com', phone: '1234567', gateway: 'paypal' };
  assert.equal((await priceStay(input)).priceKrw, 350000);
  assert.equal((await quoteCheckout(input)).amount, 250);
  for (const propertyId of ['', '../unwadang', 'a'.repeat(129)]) {
    await assert.rejects(priceStay({ ...input, propertyId }));
  }
});

test('six-person capacity accepts six adults and rejects seven before pricing', async () => {
  db.property[0].maxGuests = 6; expectedAdults = 6;
  const input = { propertyId: pid, checkIn: '2027-10-01', checkOut: '2027-10-03', guests: 6 };
  assert.equal((await priceStay(input)).priceKrw, 350000);
  const before = fetchLog.length;
  await assert.rejects(priceStay({ ...input, guests: 7 }));
  assert.equal(fetchLog.length, before);
});

test('PayPal start holds inventory and creates only one provider order across retries', async () => {
  db.checkoutOrder = [order({ status: 'quoted', paymentKey: null, beds24Id: null })];
  const first = await startCheckout(current()); const second = await startCheckout(current());
  assert.ok('approvalUrl' in first && first.approvalUrl?.startsWith('https://www.sandbox.paypal.com/'));
  assert.deepEqual(first, second); assert.equal(createCalls, 1); assert.equal(bedsCreates, 1); assert.equal(captureCalls, 0);
  assert.equal(current().paymentKey, 'PP-ORDER');
});
test('changed Beds24 price stops start before room hold or payment order', async () => {
  price = 360000; db.checkoutOrder = [order({ status: 'quoted', paymentKey: null, beds24Id: null })];
  await assert.rejects(startCheckout(current())); assert.equal(bedsCreates, 0); assert.equal(createCalls, 0);
});
test('untrusted webhook wakeup cannot capture an approved PayPal order', async () => {
  await reconcileCheckout(id); assert.equal(captureCalls, 0); assert.equal(current().status, 'awaiting_payment');
});
test('approval captures once and confirms the held Beds24 reservation', async () => {
  await reconcileCheckout(id, true); await reconcileCheckout(id, true);
  assert.equal(captureCalls, 1); assert.equal(current().status, 'confirmed'); assert.equal(remoteStatus, 'confirmed');
  assert.equal(db.booking.length, 1); assert.equal(db.event.length, 1);
});
test('lost capture response recovers from PayPal without a second charge', async () => {
  lostCapture = true; await assert.rejects(reconcileCheckout(id, true)); assert.equal(current().status, 'approving');
  await reconcileCheckout(id); assert.equal(captureCalls, 1); assert.equal(current().status, 'confirmed');
});
test('amount or local order substitution cannot capture or confirm', async () => {
  amount = '1.00'; await assert.rejects(reconcileCheckout(id, true)); assert.equal(captureCalls, 0); assert.equal(current().status, 'review');
  amount = '250.00'; customId = 'other'; await assert.rejects(getPayPalPayment(current()));
});
test('expired unpaid approval releases hold without capture; lookup outage retains it', async () => {
  db.checkoutOrder = [order({ expiresAt: new Date(0) })]; outage = true;
  await assert.rejects(reconcileCheckout(id)); assert.equal(remoteStatus, 'black');
  outage = false; await reconcileCheckout(id); assert.equal(remoteStatus, 'cancelled'); assert.equal(captureCalls, 0);
});
test('lost create response cannot expose approval URL; hold expires safely', async () => {
  db.checkoutOrder = [order({ status: 'quoted', paymentKey: null, beds24Id: null })]; lostCreate = true;
  await assert.rejects(startCheckout(current())); assert.equal(current().paymentKey, null);
  db.checkoutOrder[0].expiresAt = new Date(0); await reconcileCheckout(id);
  assert.equal(current().status, 'expired'); assert.equal(captureCalls, 0);
});
test('pending capture keeps inventory beyond expiry', async () => {
  captureStatus = 'PENDING'; ppStatus = 'COMPLETED'; db.checkoutOrder = [order({ status: 'approving', expiresAt: new Date(0) })];
  await reconcileCheckout(id); assert.equal(remoteStatus, 'black'); assert.equal(current().status, 'approving');
  captureStatus = 'COMPLETED'; await reconcileCheckout(id); assert.equal(current().status, 'confirmed');
});
test('refund waits for completed provider refund before cancelling Beds24', async () => {
  await reconcileCheckout(id, true); refundStatus = 'PENDING';
  await assert.rejects(requestRefund(id)); assert.equal(remoteStatus, 'confirmed'); assert.equal(current().paypalRefundId, 'PP-REFUND');
  await assert.rejects(reconcileCheckout(id)); assert.equal(refundCalls, 1);
  refundStatus = 'COMPLETED'; captureStatus = 'REFUNDED'; await reconcileCheckout(id);
  assert.equal(current().status, 'refunded'); assert.equal(remoteStatus, 'cancelled'); assert.equal(db.booking[0].status, 'cancelled');
});
test('lost refund response recovers; partial refunds require review', async () => {
  await reconcileCheckout(id, true); lostRefund = true;
  await assert.rejects(requestRefund(id)); await reconcileCheckout(id);
  assert.equal(refundCalls, 1); assert.equal(current().status, 'refunded');
  db.checkoutOrder = [order({ status: 'refund_pending' })]; captureStatus = 'PARTIALLY_REFUNDED';
  await reconcileCheckout(id); assert.equal(current().status, 'review'); assert.equal(refundCalls, 1);
});
test('old unknown refund is not reposted beyond idempotency window', async () => {
  captureStatus = 'COMPLETED'; db.checkoutOrder = [order({ status: 'refund_pending', paypalRefundRequestedAt: new Date(0) })];
  await assert.rejects(reconcileCheckout(id)); assert.equal(refundCalls, 0); assert.equal(current().status, 'review');
});
test('PayPal mode mismatch and malicious approval URLs fail closed', async () => {
  process.env.PAYPAL_ENV = 'live'; await assert.rejects(getPayPalPayment(current())); assert.equal(fetchLog.length, 0);
  process.env.PAYPAL_ENV = 'sandbox'; maliciousLink = true; ppStatus = 'PAYER_ACTION_REQUIRED';
  await assert.rejects(startCheckout(current())); assert.equal(captureCalls, 0);
});
