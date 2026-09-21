import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayBookings, type MobileBooking } from '../lib/mobile-booking-calendar';

const bookings: MobileBooking[] = [
  { id: 'arrival', title: 'Next guest', propertyName: 'A', start: '2026-09-21', end: '2026-09-24', type: 'reservation' },
  { id: 'departure', title: 'Previous guest', propertyName: 'A', start: '2026-09-19', end: '2026-09-21', type: 'reservation' },
  { id: 'block', title: 'Maintenance', propertyName: 'B', start: '2026-09-20', end: '2026-09-23', type: 'block' },
];

test('same-day turnover shows both reservations with departure first', () => {
  assert.deepEqual(dayBookings(bookings, '2026-09-21').map(e => e.id), ['departure', 'arrival', 'block']);
});
test('blocks end exclusively while reservation departure remains visible', () => {
  assert.deepEqual(dayBookings(bookings, '2026-09-23').map(e => e.id), ['arrival']);
  assert.deepEqual(dayBookings(bookings, '2026-09-24').map(e => e.id), ['arrival']);
  assert.deepEqual(dayBookings(bookings, '2026-09-25'), []);
});
