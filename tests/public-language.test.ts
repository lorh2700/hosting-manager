import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translatePublic } from '../lib/public-copy';

test('public language displays one language for bilingual checkout messages', () => {
  const message = '예약 확정 / Booking confirmed';
  assert.equal(translatePublic(message, 'ko'), '예약 확정');
  assert.equal(translatePublic(message, 'en'), 'Booking confirmed');
});
test('English calendar keeps minimum and maximum stay requirements', () => {
  assert.equal(translatePublic('선택한 일정은 최소 2박부터 예약할 수 있습니다.', 'en'), 'This stay requires at least 2 nights.');
  assert.equal(translatePublic('선택한 일정은 최대 7박까지 예약할 수 있습니다.', 'en'), 'This stay requires no more than 7 nights.');
});
test('English stay options preserve charges and restrictions', () => {
  assert.equal(translatePublic('2마리 · 100,000원 / 숙박 1회', 'en'), '2 dogs · KRW 100,000 per stay');
  assert.equal(translatePublic('도원재는 반려견 입실이 불가합니다.', 'en'), 'Dogs are not permitted at Dowonjae.');
  assert.equal(translatePublic('경북 영주', 'en'), 'Yeongju, Gyeongbuk');
});
test('unrecognized authored text is preserved rather than invented', () => {
  assert.equal(translatePublic('별도 취소 규정 원문', 'en'), '별도 취소 규정 원문');
});
