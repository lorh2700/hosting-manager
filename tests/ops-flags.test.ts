import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGuestFlags, nightsBetween } from '../lib/ops-flags';

test('얼리 체크인·레이트 체크아웃·요청사항 태그를 한국어·영어 대화에서 뽑는다', () => {
  assert.deepEqual(detectGuestFlags(['혹시 얼리 체크인 가능할까요?']), ['early_checkin', 'request']);
  assert.deepEqual(detectGuestFlags(['Can we drop off our bags before check-in?']), ['early_checkin']);
  assert.deepEqual(detectGuestFlags(['Is late checkout possible? Our flight is at 6pm.']), ['late_checkout']);
  assert.deepEqual(detectGuestFlags(['체크아웃을 1시로 미룰 수 있을까요']), ['late_checkout', 'request']);
  assert.deepEqual(detectGuestFlags(['아기 침대가 필요해요']), ['request']);
  assert.deepEqual(detectGuestFlags(['Thanks, see you tomorrow!']), []);
  assert.deepEqual(detectGuestFlags([]), []);
});

test('박 수 계산', () => {
  assert.equal(nightsBetween('2026-09-03', '2026-09-06'), 3);
  assert.equal(nightsBetween('2026-09-06', '2026-09-06'), 0);
  assert.equal(nightsBetween('2026-12-30', '2027-01-02'), 3);
});
