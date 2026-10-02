import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jongnoCalendarHref, jongnoRecommendationQuery, jongnoRangeDays, selectJongnoRecommendations,
  jongnoMonthDays, moveJongnoMonth, jongnoEventFee, jongnoEventTitle, jongnoDateLabel, jongnoVerifiedDate, readJongnoEvents } from '../lib/jongno-events-view';
import type { JongnoEventDTO } from '../lib/jongno-events';

const event: JongnoEventDTO = { id: 'event-1', titleKo: '종로 전시', titleEn: 'Jongno exhibition',
  descriptionKo: '원문', descriptionEn: '', category: 'exhibition', area: 'bukchon', venue: '박물관', address: '',
  startDate: '2026-10-01', endDate: '2026-10-10', timeText: '', excludedWeekdays: [], excludedDates: [],
  feeType: 'unknown', feeText: '', bookingRequired: false, officialUrl: 'https://example.com', bookingUrl: '', mapUrl: '',
  languageText: '', images: [], status: 'published', verifiedAt: '2026-10-01T00:00:00Z', version: 1, updatedAt: '2026-10-01T00:00:00Z' };

test('stay recommendation range includes checkout day without fabricating missing dates', () => {
  assert.equal(jongnoRangeDays('2026-10-01', '2026-10-03'), 3);
  assert.equal(jongnoRecommendationQuery('2026-10-01', '2026-10-03'), 'from=2026-10-01&to=2026-10-03&limit=100');
  for (const dates of [[null, null], ['2026-10-01', null], ['2026-10-03', '2026-10-01'], ['2026-02-30', '2026-03-01']]) {
    assert.equal(jongnoRecommendationQuery(dates[0], dates[1]), '');
  }
  assert.notEqual(jongnoRecommendationQuery('2026-10-01', '2027-01-01'), ''); // 93 days inclusive.
  assert.equal(jongnoRecommendationQuery('2026-10-01', '2027-01-02'), '');
});

test('calendar handoff carries only dates and language, including a long period', () => {
  const href = jongnoCalendarHref('2026-10-01', '2027-02-01', 'en');
  const url = new URL(href, 'https://voidanchae.com');
  assert.equal(url.pathname, '/guide/jongno-events');
  assert.deepEqual([...url.searchParams.keys()], ['lang', 'from', 'to']);
  assert.equal(url.searchParams.get('to'), '2027-02-01');
  assert.equal(jongnoCalendarHref(null, '2026-10-03', 'ko'), '/guide/jongno-events?lang=ko');
});

test('only published events with an open day in the stay are recommended, at most three', () => {
  const closed = { ...event, id: 'closed', excludedWeekdays: [5] }; // Friday, Oct 2.
  const excluded = { ...event, id: 'excluded', excludedDates: ['2026-10-02'] };
  const outside = { ...event, id: 'outside', startDate: '2026-10-03' };
  const draft = { ...event, id: 'draft', status: 'draft' as const };
  const cancelled = { ...event, id: 'cancelled', status: 'cancelled' as const };
  const available = Array.from({ length: 5 }, (_, index) => ({ ...event, id: `open-${index}` }));
  assert.deepEqual(selectJongnoRecommendations([closed, excluded, outside, draft, cancelled, ...available], '2026-10-02', '2026-10-02').map(item => item.id), ['open-0', 'open-1', 'open-2']);
  assert.equal(selectJongnoRecommendations([closed], '2026-10-02', '2026-10-03').length, 1);
  assert.deepEqual(selectJongnoRecommendations([], '2026-10-02', '2026-10-03'), []);
  assert.deepEqual(selectJongnoRecommendations(available, '2026-10-03', '2026-10-02'), []);
});

test('month navigation handles year boundaries, leap days and calendar limits', () => {
  assert.equal(jongnoMonthDays('2028-02').length, 29);
  assert.equal(jongnoMonthDays('2026-02').at(-1), '2026-02-28');
  assert.equal(jongnoMonthDays('2026-04').length, 30);
  assert.equal(moveJongnoMonth('2026-12', 1), '2027-01');
  assert.equal(moveJongnoMonth('2026-01', -1), '2025-12');
  assert.equal(moveJongnoMonth('1900-01', -1), '1900-01');
  assert.equal(moveJongnoMonth('2199-12', 1), '2199-12');
  assert.deepEqual(jongnoMonthDays('2026-13'), []);
});

test('authored details remain literal while unknown fees and untranslated titles are explicit', () => {
  assert.equal(jongnoEventFee(event, 'en'), 'Check fees');
  assert.equal(jongnoEventFee({ ...event, feeType: 'paid' }, 'ko'), '유료');
  assert.equal(jongnoEventFee({ ...event, feeText: '회원 할인 별도' }, 'en'), '회원 할인 별도');
  assert.equal(jongnoEventTitle({ ...event, titleEn: '' }, 'en'), '종로 전시');
  assert.match(jongnoDateLabel('2026-10-02', 'en', { weekday: 'long', month: 'long', day: 'numeric' }), /Friday/);
});

test('editorial confirmation dates use Seoul timezone rather than the UTC date prefix', () => {
  assert.equal(jongnoVerifiedDate('2026-10-01T15:30:00Z'), '2026-10-02');
  assert.equal(jongnoVerifiedDate('2026-10-01T14:30:00Z'), '2026-10-01');
  assert.equal(jongnoVerifiedDate(null), null); assert.equal(jongnoVerifiedDate('invalid'), null);
});

test('public lookup passes cancellation through and rejects unavailable or malformed results', async t => {
  const controller = new AbortController();
  let request: { url: string; options: RequestInit } | null = null;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    request = { url, options };
    return Response.json({ events: [], hasMore: false, nextCursor: null, range: { from: '2026-10-01', to: '2026-10-31' } });
  });
  const result = await readJongnoEvents('month=2026-10', controller.signal);
  assert.deepEqual(result.events, []);
  assert.equal(request!.url, '/api/public/jongno-events?month=2026-10');
  assert.equal(request!.options.signal, controller.signal); assert.equal(request!.options.cache, 'no-store');
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(readJongnoEvents('month=2026-10', controller.signal), /unavailable/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ events: [], hasMore: false, nextCursor: null, range: null }));
  await assert.rejects(readJongnoEvents('month=2026-10', controller.signal), /Invalid/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ events: [], hasMore: true, nextCursor: 12, range: { from: '2026-10-01', to: '2026-10-31' } }));
  await assert.rejects(readJongnoEvents('month=2026-10', controller.signal), /Invalid/);
});
