import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLaundryOverdue, isLaundryDue, isLaundryRecordedToday, laundryPickupDateLabel, type LaundryViewRow } from '../lib/laundry-view';

const today = '2026-10-02';
const row = (over: Partial<LaundryViewRow> = {}): LaundryViewRow => ({ status: 'collected', pickupDate: '2026-10-01', deliveryDate: '', ...over });

test('unknown delivery dates are neither due nor overdue even when a quick-send recording day has passed', () => {
  for (const deliveryDate of ['', ' ', '2026-02-30', '2026-10-2', 'not-a-date']) {
    const pending = row({ deliveryDate, history: [{ request: { quickSend: true } }] });
    assert.equal(isLaundryDue(pending, today), false);
    assert.equal(isLaundryOverdue(pending, today), false);
  }
});

test('a confirmed delivery deadline today is due but becomes overdue only after today', () => {
  for (const status of ['scheduled', 'collected', 'washing', 'shipping', 'partial']) {
    const pending = row({ status, pickupDate: today, deliveryDate: today });
    assert.equal(isLaundryDue(pending, today), true);
    assert.equal(isLaundryOverdue(pending, today), false);
    assert.equal(isLaundryOverdue(pending, '2026-10-03'), true);
  }
  assert.equal(isLaundryDue(row({ deliveryDate: '2026-10-03' }), today), false);
  assert.equal(isLaundryOverdue(row({ deliveryDate: '2026-10-03' }), today), false);
});

test('scheduled pickups are due by pickup date while collected work needs an actual delivery date', () => {
  assert.equal(isLaundryDue(row({ status: 'scheduled', deliveryDate: '2026-10-20' }), today), true);
  assert.equal(isLaundryDue(row({ status: 'scheduled', pickupDate: '2026-10-03', deliveryDate: '2026-10-20' }), today), false);
  for (const pickupDate of ['', '2026-02-30']) assert.equal(isLaundryDue(row({ status: 'scheduled', pickupDate }), today), false);
  assert.equal(isLaundryDue(row({ pickupDate: today }), today), false);
});

test('completed and cancelled batches are not due or overdue', () => {
  for (const status of ['completed', 'cancelled']) {
    const finished = row({ status, deliveryDate: '2026-10-01' });
    assert.equal(isLaundryDue(finished, today), false);
    assert.equal(isLaundryOverdue(finished, today), false);
  }
});

test('today filtering requires a valid pickup or delivery date and never treats blank dates as today', () => {
  assert.equal(isLaundryRecordedToday(row({ pickupDate: today }), today), true);
  assert.equal(isLaundryRecordedToday(row({ deliveryDate: today }), today), true);
  assert.equal(isLaundryRecordedToday(row({ status: 'completed', deliveryDate: today }), today), true);
  assert.equal(isLaundryRecordedToday(row({ pickupDate: '', deliveryDate: '' }), today), false);
  assert.equal(isLaundryRecordedToday(row({ pickupDate: '2026-02-30', deliveryDate: '2026-02-30' }), '2026-02-30'), false);
  assert.equal(isLaundryRecordedToday(row({ pickupDate: '', deliveryDate: '' }), ''), false);
});

test('date comparisons reject impossible dates and support leap dates and year boundaries', () => {
  assert.equal(isLaundryDue(row({ deliveryDate: '2028-02-29' }), '2028-02-29'), true);
  assert.equal(isLaundryOverdue(row({ deliveryDate: '2027-02-29' }), '2027-03-01'), false);
  assert.equal(isLaundryOverdue(row({ deliveryDate: '2026-12-31' }), '2027-01-01'), true);
  assert.equal(isLaundryDue(row({ deliveryDate: '2026-12-31' }), '2027-01-01'), true);
  assert.equal(isLaundryDue(row({ deliveryDate: today }), '2026-02-30'), false);
  assert.equal(isLaundryOverdue(row({ deliveryDate: today }), ''), false);
});

test('quick-send submission day is labelled as a record date until a later valid schedule confirms pickup', () => {
  const first = { action: '보냄 기록', request: { quickSend: true }, quick: { recordedAt: '2026-10-02T03:00:00Z' } };
  assert.equal(laundryPickupDateLabel(row({ history: [first] })), '기록일');
  assert.equal(laundryPickupDateLabel(row({ history: [first, { action: 'washing' }, { action: 'receive' }] })), '기록일');
  assert.equal(laundryPickupDateLabel(row({ history: [first, { action: 'schedule', schedule: { pickupDate: today } }] })), '수거');
  for (const pickupDate of ['', '2026-02-30']) {
    assert.equal(laundryPickupDateLabel(row({ history: [first, { action: 'schedule', schedule: { pickupDate } }] })), '기록일');
  }
  assert.equal(laundryPickupDateLabel(row({ history: [first, { action: 'correct', schedule: { pickupDate: today } }] })), '기록일');
});

test('malformed or legacy history is safe, and quickSend must be an explicit boolean on the first creation request', () => {
  for (const history of [undefined, null, {}, [], [null], ['text'], [3], [{ request: [] }], [{ request: { quickSend: 'true' } }], [{}, { request: { quickSend: true } }]]) {
    assert.equal(laundryPickupDateLabel(row({ history })), '수거');
  }
  const first = { request: { quickSend: true } };
  assert.equal(laundryPickupDateLabel(row({ history: [first, null, [], 'text', { action: 'schedule', schedule: null }] })), '기록일');
  assert.equal(laundryPickupDateLabel(row({ history: [{ request: { quickSend: false } }] })), '수거');
});
