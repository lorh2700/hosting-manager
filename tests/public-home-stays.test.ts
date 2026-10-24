import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { initialPublicStayCards, parsePublicStayCards, parsePublicStayResults, publicStayStartingPrice, visiblePublicStays, type PublicStayCard } from '../lib/public-home-stays';

const active = (slug: string): PublicStayCard => ({ slug, name: slug, status: 'active', region: '북촌', maxGuests: 4, images: ['/images/stay.webp'] });
const cards: PublicStayCard[] = [active('anon'), active('unwadang'), active('new-stay'), { ...active('jarakheon'), status: 'coming_soon', images: [] }];

test('관리자에게 저장된 설명·어메니티·기준 인원과 시작가를 카드에 전달한다', () => {
  const [card] = parsePublicStayCards([{ ...active('new-stay'), name: '수정된 숙소', description: '상세 설명', catchphrase: '짧은 소개',
    amenities: ['Wi-Fi', '주방'], baseGuests: 3, basePrice: 235000 }])!;
  assert.equal(card.name, '수정된 숙소');
  assert.equal(card.baseGuests, 3);
  assert.equal(card.description, '상세 설명');
  assert.equal(card.catchphrase, '짧은 소개');
  assert.deepEqual(card.amenities, ['Wi-Fi', '주방']);
  assert.equal(publicStayStartingPrice(card, 'ko'), '₩235,000~');
  assert.equal(parsePublicStayCards([active('old')])?.[0].baseGuests, 2);
});

test('첫 화면은 DB를 기다리지 않고 기존 숙소와 실제 WebP 대표 사진을 제공한다', () => {
  const initial = initialPublicStayCards();
  assert.deepEqual(initial.map(card => card.slug), ['unwadang', 'hwayeonjae', 'anon', 'dowonjae', 'byulha', 'jarakheon']);
  assert.equal(initial.find(card => card.slug === 'jarakheon')?.status, 'coming_soon');
  for (const card of initial.filter(card => card.status === 'active')) {
    assert.equal(publicStayStartingPrice(card, 'ko'), '20만원~');
    assert.equal(card.images.length, 1);
    assert.ok(card.images[0].endsWith('.webp'));
    assert.ok(existsSync(new URL(`../public${card.images[0]}`, import.meta.url)));
  }
});

test('기본 시작가는 20만원이며 숙소별로 저장된 요금은 우선한다', () => {
  assert.equal(publicStayStartingPrice(active('anon'), 'ko'), '20만원~');
  assert.equal(publicStayStartingPrice({ ...active('anon'), basePrice: null }, 'en'), 'From ₩200,000');
  assert.equal(publicStayStartingPrice({ ...active('anon'), basePrice: 300000 }, 'ko'), '30만원~');
  assert.equal(publicStayStartingPrice({ ...active('anon'), basePrice: 175000 }, 'ko'), '₩175,000~');
});

test('기존 JPG는 준비된 WebP로 바꾸고 사용자 등록 사진 경로는 유지한다', () => {
  const images = ['/images/byulha/DSC01785.jpg', '/images/custom/photo.jpg', 'https://storage.example.com/byulha.jpg'];
  assert.deepEqual(parsePublicStayCards([{ ...active('byulha'), images }])?.[0].images,
    ['/images/byulha/DSC01785.webp', '/images/custom/photo.jpg', 'https://storage.example.com/byulha.jpg']);
  assert.deepEqual(parsePublicStayCards([{ ...active('constructor'), images }])?.[0].images, images);
});

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
