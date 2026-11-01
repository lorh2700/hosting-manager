import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutRefundTerms, readRefundPolicy, refundPolicyRows, refundPolicyTerms, type RefundPolicy } from '../lib/refund-policy';

const agreed: RefundPolicy = { tiers: [
  { minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 8, refundPercent: 25 },
  { minDaysBefore: 15, refundPercent: 50 }, { minDaysBefore: 22, refundPercent: 75 },
  { minDaysBefore: 30, refundPercent: 100 },
] };

test('승인한 숙소 환불 구간을 빠짐없이 큰 일수부터 한국어와 영어로 표시한다', () => {
  assert.deepEqual(readRefundPolicy(agreed), agreed);
  const before = structuredClone(agreed);
  assert.deepEqual(refundPolicyRows(agreed).map(row => [row.label, row.refundPercent]), [
    ['30일 이상 전', 100], ['22~29일 전', 75], ['15~21일 전', 50], ['8~14일 전', 25], ['7일 이내', 0],
  ]);
  assert.deepEqual(refundPolicyRows(agreed, 'en').map(row => row.label), [
    '30 or more days before check-in', '22–29 days before check-in', '15–21 days before check-in',
    '8–14 days before check-in', 'Within 7 days before check-in',
  ]);
  for (let days = 0; days <= 60; days++) {
    const matching = refundPolicyRows(agreed).filter(row => days >= row.minDaysBefore && (row.maxDaysBefore === null || days <= row.maxDaysBefore));
    assert.equal(matching.length, 1);
    assert.equal(matching[0].refundPercent, days < 8 ? 0 : days < 15 ? 25 : days < 22 ? 50 : days < 30 ? 75 : 100);
  }
  assert.deepEqual(agreed, before);
});

test('정책이 없거나 잘못 저장된 숙소는 임의 환불 규정을 만들지 않는다', () => {
  const invalid = [null, undefined, {}, { tiers: [] }, { tiers: [agreed.tiers[0]] },
    { ...agreed, private: 'not public' },
    { tiers: [{ minDaysBefore: 0, refundPercent: 0, extra: true }, { minDaysBefore: 30, refundPercent: 100 }] },
    { tiers: [{ minDaysBefore: 1, refundPercent: 0 }, { minDaysBefore: 30, refundPercent: 100 }] },
    { tiers: [{ minDaysBefore: 0, refundPercent: 80 }, { minDaysBefore: 30, refundPercent: 50 }] },
    { tiers: [{ minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 0, refundPercent: 100 }] },
    { tiers: [{ minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 30.5, refundPercent: 100 }] },
    { tiers: [{ minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 30, refundPercent: 101 }] },
    { tiers: [{ minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 3651, refundPercent: 100 }] },
    { tiers: Array.from({ length: 53 }, (_, minDaysBefore) => ({ minDaysBefore, refundPercent: 100 })) },
  ];
  for (const value of invalid) {
    assert.equal(readRefundPolicy(value), null);
    assert.equal(checkoutRefundTerms(value, 'Existing terms\n기존 약관'), 'Existing terms\n기존 약관');
  }
});

test('결제 약관은 당시 숙소 정책의 한영 문구를 저장하며 이후 설정 변경과 분리된다', () => {
  const policy = structuredClone(agreed);
  const terms = checkoutRefundTerms(policy, 'Outdated global policy');
  assert.ok(terms.includes('30일 이상 전: 100% 환불'));
  assert.ok(terms.includes('7일 이내: 환불 불가 (0%)'));
  assert.ok(terms.includes('Within 7 days before check-in: Non-refundable (0%)'));
  assert.ok(!terms.includes('Outdated'));
  policy.tiers[0].refundPercent = 25;
  assert.ok(terms.includes('7일 이내: 환불 불가 (0%)'));
  assert.notEqual(terms, checkoutRefundTerms(policy, 'fallback'));
});

test('숙소의 사용자 지정 하루 구간과 당일 구간도 정확히 표시한다', () => {
  const policy: RefundPolicy = { tiers: [
    { minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 1, refundPercent: 10 },
    { minDaysBefore: 2, refundPercent: 100 },
  ] };
  assert.deepEqual(refundPolicyRows(policy).map(row => row.label), ['2일 이상 전', '1일 전', '체크인 당일']);
  assert.ok(refundPolicyTerms(policy, 'en').includes('1 day before check-in: 10% refund'));
  assert.ok(refundPolicyTerms(policy, 'en').includes('Check-in day: Non-refundable (0%)'));
});
