import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicStayCards, parsePublicStayResults, visiblePublicStays, type PublicStayCard } from '../lib/public-home-stays';

const active = (slug: string): PublicStayCard => ({ slug, name: slug, status: 'active', region: '북촌', maxGuests: 4, images: ['/images/stay.webp'] });
const cards: PublicStayCard[] = [active('anon'), active('unwadang'), active('new-stay'), { ...active('jarakheon'), status: 'coming_soon', images: [] }];

test('사진이 준비되지 않은 오픈 예정 지점도 표시하고 공개 중지된 지점은 제외한다', () => {
  const parsed = parsePublicStayCards([...cards, { ...active('closed-stay'), status: 'closed' }]);
  assert.deepEqual(parsed?.map(card => card.slug), ['unwadang', 'anon', 'jarakheon', 'new-stay']);
  assert.deepEqual(parsed?.find(card => card.slug === 'jarakheon')?.images, []);
});

test('숙소 조회 실패 응답은 빈 목록과 구분하고 저장되지 않은 기준요금은 만들지 않는다', () => {
  assert.equal(parsePublicStayCards({ error: 'database unavailable' }), null);
  assert.equal(parsePublicStayCards([{ ...cards[0], images: undefined }]), null);
  assert.deepEqual(parsePublicStayCards([]), []);
  const parsed = parsePublicStayCards([{ ...cards[0], basePrice: null }, { ...cards[1], basePrice: 175000 }]);
  assert.equal(parsed?.find(card => card.slug === 'anon')?.basePrice, null);
  assert.equal(parsed?.find(card => card.slug === 'unwadang')?.basePrice, 175000);
});

test('검색 실패나 검색 중에도 숙소 소개는 볼 수 있고 오픈 예정 지점은 날짜 검색에서 제외한다', () => {
  for (const search of [{ active: true, loading: true, failed: false, results: [] }, { active: true, loading: false, failed: true, results: [] }]) {
    assert.deepEqual(visiblePublicStays(cards, search).map(card => card.slug), ['anon', 'unwadang', 'new-stay']);
  }
  assert.deepEqual(visiblePublicStays(cards, { active: false, loading: false, failed: false, results: [] }), cards);
});

test('확인된 매진만 제외하고 조회 실패·누락 지점을 예약 가능으로 오인하지 않게 유지한다', () => {
  const results = [{ slug: 'anon', status: 'unavailable' as const }, { slug: 'unwadang', status: 'available' as const, priceKrw: 450000, nights: 3 }, { slug: 'new-stay', status: 'error' as const }];
  assert.deepEqual(visiblePublicStays(cards, { active: true, loading: false, failed: false, results }).map(card => card.slug), ['unwadang', 'new-stay']);
  assert.deepEqual(visiblePublicStays(cards, { active: true, loading: false, failed: false, results: [] }).map(card => card.slug), ['anon', 'unwadang', 'new-stay']);
});

test('금액이나 숙박일수가 없는 불완전한 견적은 예약 가능으로 표시하지 않는다', () => {
  assert.equal(parsePublicStayResults({ error: 'unavailable' }), null);
  assert.equal(parsePublicStayResults({ results: [{ slug: 'anon', status: 'unknown' }] }), null);
  const parsed = parsePublicStayResults({ results: [{ slug: 'anon', status: 'available', priceKrw: null, nights: 2 }, { slug: 'unwadang', status: 'available', priceKrw: 450000, nights: 3 }] });
  assert.deepEqual(parsed, [{ slug: 'anon', status: 'error' }, { slug: 'unwadang', status: 'available', priceKrw: 450000, nights: 3 }]);
});
