import assert from 'node:assert/strict';
import test from 'node:test';
import { estimatedTourPrice, tourInquiryReceiptSignature, tourSelectionIssue, tourSelectionsForSubmission } from '../app/(public)/book/[id]/tour-selection';
import type { StayTour, StayTourSelectionInput } from '../lib/stay-tour-types.ts';

const tour: StayTour = { id: 'tour1', title: 'Example tour', slug: 'example', description: null, meetingPoint: null, durationMin: 60, basePrice: 20000, maxGroupSize: 6, images: [], durationOptions: [], ticketTiers: [] };
const selection: StayTourSelectionInput = { tourId: 'tour1', requestedDate: '2026-12-03', requestedTime: '14:30', guests: 2, language: 'ko' };

test('adding a checkout email preserves an existing tour request while another person or schedule does not', () => {
  const input = { propertyId: 'p1', checkIn: '2026-12-01', checkOut: '2026-12-04', name: 'Example guest', phone: '010-0000-0000', tourSelections: [selection] };
  const original = tourInquiryReceiptSignature(input);
  assert.equal(tourInquiryReceiptSignature({ ...input, email: 'example@example.com' }), original);
  assert.notEqual(tourInquiryReceiptSignature({ ...input, phone: '010-1111-1111' }), original);
  assert.notEqual(tourInquiryReceiptSignature({ ...input, name: 'Another example guest' }), original);
  assert.notEqual(tourInquiryReceiptSignature({ ...input, tourSelections: [{ ...selection, requestedTime: '15:30' }] }), original);
});

test('submission excludes unselected ticket tiers without changing the editable selection', () => {
  const input = [{ ...selection, tickets: [{ tierId: 'adult', count: 2 }, { tierId: 'child', count: 0 }] }];
  const normalized = tourSelectionsForSubmission(input);
  assert.deepEqual(normalized[0].tickets, [{ tierId: 'adult', count: 2 }]);
  assert.deepEqual(input[0].tickets, [{ tierId: 'adult', count: 2 }, { tierId: 'child', count: 0 }]);
  assert.deepEqual(tourSelectionsForSubmission([selection]), [selection]);
});

test('unselected tours never block accommodation checkout', () => {
  assert.equal(tourSelectionIssue([], '', '', 2, false), null);
});
test('changing a stay does not silently change an incompatible requested tour date', () => {
  assert.match(tourSelectionIssue([selection], '2026-12-04', '2026-12-06', 2, false)!, /투어 날짜/);
  assert.equal(selection.requestedDate, '2026-12-03');
  assert.equal(tourSelectionIssue([selection], '2026-12-01', '2026-12-03', 2, false), null);
});
test('tour requests require time, staying participants and matching ticket quantities', () => {
  assert.match(tourSelectionIssue([{ ...selection, requestedTime: '' }], '2026-12-01', '2026-12-05', 2, true)!, /preferred time/);
  assert.match(tourSelectionIssue([selection], '2026-12-01', '2026-12-05', 1, true)!, /participants/);
  assert.match(tourSelectionIssue([{ ...selection, tickets: [{ tierId: 'adult', count: 1 }] }], '2026-12-01', '2026-12-05', 2, true)!, /ticket quantity/);
});
test('tour estimates distinguish free and unspecified prices', () => {
  assert.equal(estimatedTourPrice(tour, selection), 40000);
  assert.equal(estimatedTourPrice({ ...tour, basePrice: 0 }, selection), 0);
  assert.equal(estimatedTourPrice({ ...tour, basePrice: null }, selection), null);
});
test('course prices override base prices and ticket prices replace course prices', () => {
  const withCourse = { ...tour, durationOptions: [{ id: 'long', label: 'Long course', durationMin: 120, price: 30000 }] };
  assert.equal(estimatedTourPrice(withCourse, { ...selection, durationOptionId: 'long' }), 60000);
  assert.equal(estimatedTourPrice({ ...withCourse, ticketTiers: [{ id: 'adult', label: 'Adult', price: 25000, notes: null }, { id: 'child', label: 'Child', price: 15000, notes: null }] }, { ...selection, durationOptionId: 'long', tickets: [{ tierId: 'adult', count: 1 }, { tierId: 'child', count: 1 }] }), 40000);
});
