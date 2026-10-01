import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsOpsCleaning, opsNextAction, opsCleaningLabel, opsDeliveryLabel } from '../lib/ops-attention';
import type { OpsProperty, OpsReservation } from '../app/api/ops/today/route';

const reservation = { id: 'guest', hasChat: true, readyDelivery: 'sent' } as OpsReservation;
const property = (overrides: Partial<OpsProperty> = {}): OpsProperty => ({
  id: 'stay', name: '숙소', hasWork: true, checkouts: [], checkins: [reservation], camera: [], readyMessage: 'ready',
  cleaning: null, checkoutStatus: null, ...overrides,
});
const done = { id: 'clean', status: 'done', cleanerId: 'staff', cleanerName: '담당자', notes: null, supplies: null };

test('a completed cleaning does not hide a failed room-ready message', () => {
  const p = property({ cleaning: done, checkins: [{ ...reservation, readyDelivery: 'failed' }] });
  assert.equal(opsNextAction(p, true)?.kind, 'message');
  assert.equal(opsNextAction(p, true)?.tone, 'danger');
  assert.equal(opsNextAction(p, true, { guest: 'sent' }), null);
});
test('checkout confirmation remains actionable after cleaning is done', () => {
  const p = property({ cleaning: done, checkouts: [reservation] });
  assert.equal(opsNextAction(p, true)?.kind, 'checkout');
});
test('check-in-only days offer room-ready messaging without creating a cleaning task', () => {
  const p = property({ checkins: [{ ...reservation, readyDelivery: null }] });
  assert.equal(needsOpsCleaning(p), false);
  assert.equal(opsCleaningLabel(p, true), '청소 없음');
  assert.equal(opsNextAction(p, true)?.kind, 'message');
});
test('unknown operational data is actionable and cannot be marked complete', () => {
  assert.equal(opsNextAction(property({ cleaning: done }), false)?.kind, 'unknown');
  assert.equal(opsCleaningLabel(property({ cleaning: done }), false), '확인 필요');
  assert.equal(opsNextAction(property({ hasWork: false, checkins: [] }), false), null);
});
test('unassigned versus assigned cleaning and local-only delivery remain distinct', () => {
  const p = property({ cleaning: { ...done, status: 'pending', cleanerId: null } });
  assert.equal(opsNextAction(p, true)?.kind, 'assign');
  assert.equal(opsCleaningLabel(p, true), '미배정');
  assert.equal(opsNextAction(property({ cleaning: { ...done, status: 'pending' } }), true)?.kind, 'cleaning');
  assert.equal(opsDeliveryLabel('sent'), 'Beds24 접수 완료');
  assert.equal(opsDeliveryLabel('local_only'), '내부 기록 · 게스트 미전송');
});
