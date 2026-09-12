import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db, resetDb } from './stubs/prisma';
import { setFetchHandler, json, fetchLog, resetFetch } from './helpers/beds24-mock';
import { chargeAmount, assertPayment, toMinor } from '../lib/payments/money';
import { selectOffer, checkoutMarker } from '../lib/payments/beds';
import { startCheckout, reconcileCheckout, authorizedOrder, requestRefund } from '../lib/payments/checkout';
import { requireUnpaidBooking } from '../lib/payments/guard';
import type { CheckoutOrder } from '../generated/prisma/client';

const id = 'e1a6bb45-d76c-4322-b270-76934162bf35';
const pid = '02b10660-965d-4714-a0fe-55dc90956ea3';
const order = (over: Partial<CheckoutOrder> = {}): CheckoutOrder => ({ id, propertyId: pid, roomId: 555, offerId: 1,
  tokenHash: createHash('sha256').update('valid-token').digest('hex'), propertyName: 'Test', checkIn: '2027-10-01', checkOut: '2027-10-03', guests: 2,
  name: 'Test Guest', email: 'test@example.com', phone: '+12025550100', gateway: 'card', mode: 'test', currency: 'KRW', amountMinor: 350000, priceKrw: 350000,
  fxRate: null, terms: 'Test terms', termsAcceptedAt: null, status: 'awaiting_payment', beds24Id: '123', paymentKey: null, bookingId: null,
  paypalRefundId: null, paypalRefundRequestedAt: null,
  expiresAt: new Date(Date.now() + 900000), leaseUntil: null, lastError: null, createdAt: new Date(), updatedAt: new Date(), ...over });

let remoteStatus: string;
let paymentStatus: string;
let amount: number;
let loseApproval: boolean;
let holdCreates: number;
let loseHold: boolean;
let providerUnavailable: boolean;
let refundUnavailable: boolean;
let failApprovalBeforeResponse: boolean;

beforeEach(() => {
  resetDb(); resetFetch(); remoteStatus = 'black'; paymentStatus = 'IN_PROGRESS'; amount = 350000; loseApproval = false; holdCreates = 0;
  loseHold = false; providerUnavailable = false; refundUnavailable = false; failApprovalBeforeResponse = false;
  process.env.CHECKOUT_ENABLED = 'true'; process.env.CHECKOUT_MODE = 'test'; process.env.CHECKOUT_PROPERTY_IDS = pid;
  process.env.CHECKOUT_BEDS24_OFFER_ID = '1'; process.env.CHECKOUT_SITE_URL = 'http://localhost:3100'; process.env.CHECKOUT_TERMS = 'Test terms';
  process.env.CRON_SECRET = 'test-cron'; process.env.CHECKOUT_PRICE_INCLUDES_ALL_FEES = 'true';
  process.env.TOSS_CLIENT_KEY = 'test_ck_fake'; process.env.TOSS_SECRET_KEY = 'test_sk_fake';
  db.checkoutOrder = [order()];
  setFetchHandler((url, init) => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
    if (url.hostname === 'api.tosspayments.com') {
      if (providerUnavailable || (refundUnavailable && url.pathname.endsWith('/cancel')) || (failApprovalBeforeResponse && url.pathname.endsWith('/confirm'))) throw new Error('Provider timeout');
      if (url.pathname.endsWith('/confirm')) { paymentStatus = 'DONE'; if (loseApproval) throw new Error('Connection lost after approval'); }
      if (url.pathname.endsWith('/cancel')) paymentStatus = 'CANCELED';
      return json({ orderId: id, currency: 'KRW', totalAmount: amount, paymentKey: 'pk_test', status: paymentStatus });
    }
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 350000, unitsAvailable: 1 }] }] });
    if (url.pathname.endsWith('/bookings') && init.method === 'POST') {
      const payload = JSON.parse(init.body!)[0];
      if (!payload.id) { holdCreates++; assert.equal(payload.actions.checkAvailability, true); if (loseHold) throw new Error('Response lost after hold creation'); }
      remoteStatus = payload.status;
      return json([{ success: true, new: { id: 123 } }]);
    }
    if (url.pathname.endsWith('/bookings')) return json({ data: [{ id: 123, roomId: 555, custom1: checkoutMarker(id), arrival: '2027-10-01', departure: '2027-10-03', status: remoteStatus }] });
    throw new Error(`Unexpected URL ${url}`);
  });
});

test('money: exact USD cents and KRW validation; no invented rate', () => {
  assert.equal(toMinor('12.30', 'USD'), 1230);
  assert.throws(() => toMinor('12.345', 'USD'));
  assert.throws(() => toMinor('0', 'KRW'));
  assert.throws(() => toMinor('1e5', 'KRW'));
  assert.throws(() => chargeAmount(350000, 'paypal'));
  assert.deepEqual(chargeAmount(350000, 'paypal', '1400'), { currency: 'USD', amountMinor: 25000, fxRate: '1400' });
});
test('offer: no sold-out, wrong-room or alternative-rate fallback', () => {
  assert.throws(() => selectOffer({ data: [{ roomId: 555, offers: [{ offerId: 2, price: 1, unitsAvailable: 1 }] }] }, 555, 1));
  assert.throws(() => selectOffer({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 1, unitsAvailable: 0 }] }] }, 555, 1));
});
test('payment identity and currency cannot be substituted', () => {
  assert.throws(() => assertPayment(order(), { orderId: 'other', currency: 'KRW', totalAmount: 350000, paymentKey: 'pk', status: 'DONE' }));
  assert.throws(() => assertPayment(order(), { orderId: id, currency: 'USD', totalAmount: 350000, paymentKey: 'pk', status: 'DONE' }));
});
test('guest token protects order access', async () => {
  await assert.rejects(authorizedOrder(id, 'wrong'));
  assert.equal((await authorizedOrder(id, 'valid-token')).id, id);
});
test('start is idempotent and creates a checked Beds24 hold only once', async () => {
  db.checkoutOrder = [order({ status: 'quoted', beds24Id: null })];
  await startCheckout(db.checkoutOrder[0] as CheckoutOrder);
  await startCheckout(db.checkoutOrder[0] as CheckoutOrder);
  assert.equal(holdCreates, 1);
  assert.equal(db.checkoutOrder[0].status, 'awaiting_payment');
  assert.equal(fetchLog.filter(f => f.url.includes('/confirm')).length, 0);
});
test('webhook reconciliation cannot approve an authenticated but unpaid payment', async () => {
  await reconcileCheckout(id);
  assert.equal(paymentStatus, 'IN_PROGRESS');
  assert.equal(db.checkoutOrder[0].status, 'awaiting_payment');
});
test('wrong amount never approves or finalizes reservation', async () => {
  amount = 1;
  await assert.rejects(reconcileCheckout(id, true));
  assert.equal(remoteStatus, 'black');
  assert.equal(paymentStatus, 'IN_PROGRESS');
});
test('lost approval response recovers without a second charge and saves one booking', async () => {
  loseApproval = true;
  await assert.rejects(reconcileCheckout(id, true));
  assert.equal(paymentStatus, 'DONE');
  assert.equal(db.checkoutOrder[0].status, 'approving');
  await reconcileCheckout(id);
  await reconcileCheckout(id);
  assert.equal(db.checkoutOrder[0].status, 'confirmed');
  assert.equal(db.booking.length, 1);
  assert.equal(fetchLog.filter(f => f.url.endsWith('/confirm')).length, 1);
});
test('expired unpaid hold releases stock; expired paid order is fulfilled', async () => {
  db.checkoutOrder = [order({ expiresAt: new Date(Date.now() - 1000) })];
  await reconcileCheckout(id, true);
  assert.equal(db.checkoutOrder[0].status, 'expired');
  assert.equal(remoteStatus, 'cancelled');
  assert.equal(paymentStatus, 'IN_PROGRESS');
  remoteStatus = 'black'; paymentStatus = 'DONE';
  db.checkoutOrder = [order({ expiresAt: new Date(Date.now() - 1000) })];
  await reconcileCheckout(id);
  assert.equal(db.checkoutOrder[0].status, 'confirmed');
});
test('paid but cancelled remote room queues refund rather than confirming', async () => {
  remoteStatus = 'cancelled'; paymentStatus = 'DONE';
  await assert.rejects(reconcileCheckout(id));
  assert.equal(db.checkoutOrder[0].status, 'refund_pending');
  await reconcileCheckout(id);
  assert.equal(db.checkoutOrder[0].status, 'refunded');
});
test('database lease prevents concurrent payment operations', async () => {
  db.checkoutOrder[0].leaseUntil = new Date(Date.now() + 10000);
  await assert.rejects(reconcileCheckout(id, true));
  assert.equal(fetchLog.length, 0);
});
test('full refund releases reservation only after provider cancellation', async () => {
  paymentStatus = 'DONE';
  await reconcileCheckout(id);
  await assert.rejects(requireUnpaidBooking(id));
  await requestRefund(id);
  assert.equal(paymentStatus, 'CANCELED');
  assert.equal(remoteStatus, 'cancelled');
  assert.equal(db.checkoutOrder[0].status, 'refunded');
  assert.equal(db.booking[0].status, 'cancelled');
  assert.equal(db.event.length, 0);
});

test('unknown hold creation recovers its marker without creating another hold', async () => {
  db.checkoutOrder = [order({ status: 'quoted', beds24Id: null })];
  loseHold = true;
  await assert.rejects(startCheckout(db.checkoutOrder[0] as CheckoutOrder));
  assert.equal(db.checkoutOrder[0].status, 'holding');
  await reconcileCheckout(id);
  assert.equal(db.checkoutOrder[0].beds24Id, '123');
  assert.equal(db.checkoutOrder[0].status, 'awaiting_payment');
  assert.equal(holdCreates, 1);
});

test('payment lookup outage never releases an expired hold', async () => {
  db.checkoutOrder = [order({ expiresAt: new Date(Date.now() - 1000) })];
  providerUnavailable = true;
  await assert.rejects(reconcileCheckout(id));
  assert.equal(db.checkoutOrder[0].status, 'awaiting_payment');
  assert.equal(remoteStatus, 'black');
});

test('uncertain approval keeps stock past expiry and retries the authorized approval', async () => {
  failApprovalBeforeResponse = true;
  await assert.rejects(reconcileCheckout(id, true));
  assert.equal(db.checkoutOrder[0].status, 'approving');
  db.checkoutOrder[0].expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(reconcileCheckout(id));
  assert.equal(remoteStatus, 'black');
  failApprovalBeforeResponse = false;
  process.env.CHECKOUT_ENABLED = 'false';
  await reconcileCheckout(id);
  assert.equal(db.checkoutOrder[0].status, 'confirmed');
});

test('refund timeout preserves the reservation until provider cancellation is verified', async () => {
  paymentStatus = 'DONE';
  await reconcileCheckout(id);
  refundUnavailable = true;
  await assert.rejects(requestRefund(id));
  assert.equal(remoteStatus, 'confirmed');
  assert.equal(db.checkoutOrder[0].status, 'refund_pending');
  assert.equal(db.booking[0].status, 'confirmed');
  refundUnavailable = false;
  await reconcileCheckout(id);
  assert.equal(db.checkoutOrder[0].status, 'refunded');
});
