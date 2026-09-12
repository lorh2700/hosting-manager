import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalIssue, stayIssue, nextDay, type StayCalendar } from '../lib/stay-calendar';
import { GET } from '../app/api/public/stay-calendar/route';
import { db, resetDb } from './stubs/prisma';
import { setFetchHandler, json } from './helpers/beds24-mock';
import type { StubResponse } from './stubs/next-server';
import { priceStay } from '../lib/payments/checkout';
import { POST as requestBooking } from '../app/api/public/bookings/route';
import { todayKst, addDaysToDateStr } from '../lib/dates';

function calendar(): StayCalendar {
  const days: StayCalendar['days'] = {};
  for (let date = '2027-01-30'; date <= '2027-02-04'; date = nextDay(date)) {
    days[date] = { date, available: 1, minStay: 2, maxStay: 30, arrival: true, departure: true };
  }
  return { strategy: 'stayThrough', days };
}

test('월 경계를 넘는 2박은 가능하고 최소 숙박 미달·중간 마감은 차단한다', () => {
  const c = calendar();
  assert.equal(stayIssue(c, '2027-01-31', '2027-02-02'), null);
  assert.match(stayIssue(c, '2027-01-31', '2027-02-01')!, /최소 2박/);
  c.days['2027-02-01'].available = 0;
  assert.match(stayIssue(c, '2027-01-31', '2027-02-02')!, /객실이 없는/);
});

test('체크아웃 날짜 재고는 소모하지 않지만 퇴실 제한은 적용한다', () => {
  const c = calendar();
  c.days['2027-02-02'].available = 0;
  assert.equal(stayIssue(c, '2027-01-31', '2027-02-02'), null);
  c.days['2027-02-02'].departure = false;
  assert.match(stayIssue(c, '2027-01-31', '2027-02-02')!, /체크아웃이 제한/);
  c.days['2027-01-31'].arrival = false;
  assert.match(arrivalIssue(c, '2027-01-31')!, /체크인이 제한/);
});

test('firstNight와 stayThrough의 최소·최대 숙박 적용 범위를 구분한다', () => {
  const c = calendar();
  c.days['2027-02-01'].minStay = 3;
  assert.match(stayIssue(c, '2027-01-31', '2027-02-02')!, /최소 3박/);
  c.strategy = 'firstNight';
  assert.equal(stayIssue(c, '2027-01-31', '2027-02-02'), null);
  c.days['2027-01-31'].maxStay = 1;
  assert.match(stayIssue(c, '2027-01-31', '2027-02-02')!, /최대 1박/);
});

test('로딩·누락된 날짜는 예약 가능으로 처리하지 않는다', () => {
  assert.ok(arrivalIssue(null, '2027-02-10'));
  const c = calendar();
  delete c.days['2027-02-01'];
  assert.ok(stayIssue(c, '2027-01-31', '2027-02-02'));
  assert.ok(stayIssue(c, '2027-01-31', '2027-04-01'));
});

let incomplete = false;
let unavailable = false;
beforeEach(() => {
  resetDb(); incomplete = false; unavailable = false;
  process.env.CHECKOUT_BEDS24_OFFER_ID = '1';
  db.property = [{ id: 'legacy-id', status: 'active', beds24RoomId: '664844', beds24PropId: '319544', maxGuests: 6, name: '운와당' }];
  setFetchHandler(url => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'test', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 319544, currency: 'KRW', roomTypes: [{ id: 664844, restrictionStrategy: 'stayThrough' }] }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ success: true, data: [{ roomId: 664844 }] });
    if (url.pathname.endsWith('/inventory/rooms/calendar')) {
      assert.equal(url.searchParams.get('includeNumAvail'), 'true');
      assert.equal(url.searchParams.get('includeMinStay'), 'true');
      assert.equal(url.searchParams.get('includeOverride'), 'true');
      if (unavailable) return json({ success: false }, 403);
      return json({ success: true, data: [{ roomId: 664844, propertyId: 319544, calendar: [
        { from: '2027-02-10', to: incomplete ? '2027-02-10' : '2027-02-12', numAvail: 0, minStay: 2, maxStay: 365, override: 'none' },
      ] }] });
    }
    throw new Error(`Unexpected ${url.pathname}`);
  });
});
const request = (query = 'propertyId=legacy-id&start=2027-02-10&end=2027-02-12') => GET(new Request(`http://localhost/api/public/stay-calendar?${query}`), { params: Promise.resolve({}) });

test('운와당 2월 10일 재현: 자체 DB에 예약이 없어도 Beds24 재고 0과 최소 2박을 반환한다', async () => {
  const r = await request();
  assert.equal(r.status, 200);
  const data = (r as unknown as StubResponse).body;
  assert.equal(data.days['2027-02-10'].available, 0);
  assert.equal(data.days['2027-02-10'].minStay, 2);
  assert.equal(data.days['2027-02-12'].available, 0);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  await assert.rejects(priceStay({ propertyId: 'legacy-id', checkIn: '2027-02-10', checkOut: '2027-02-11', guests: 2 }), /판매 가능한 객실이 없습니다/);
});

test('Beds24 실패·불완전 응답은 503이며 DB 예약 목록으로 대체하지 않는다', async () => {
  incomplete = true;
  assert.equal((await request()).status, 503);
  incomplete = false; unavailable = true;
  assert.equal((await request()).status, 503);
});

test('잘못된 날짜·과도한 기간·미연동 숙소는 거절한다', async () => {
  assert.equal((await request('propertyId=legacy-id&start=2027-02-30&end=2027-03-01')).status, 400);
  assert.equal((await request('propertyId=legacy-id&start=2027-01-01&end=2027-12-31')).status, 400);
  db.property[0].beds24RoomId = null;
  assert.equal((await request()).status, 503);
});

test('과거 날짜는 API에서 제외해 Beds24의 생략된 과거 데이터 때문에 당월이 실패하지 않는다', async () => {
  const today = todayKst();
  setFetchHandler(url => {
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 319544, roomTypes: [{ id: 664844, restrictionStrategy: 'firstNight' }] }] });
    assert.equal(url.searchParams.get('startDate'), today);
    return json({ success: true, data: [{ roomId: 664844, propertyId: 319544, calendar: [
      { from: today, to: today, numAvail: 1, minStay: 1, maxStay: 365, override: 'noCheckInOrCheckOut' },
    ] }] });
  });
  const r = await request(`propertyId=legacy-id&start=${addDaysToDateStr(today, -10)}&end=${today}`);
  assert.equal(r.status, 200);
  const day = (r as unknown as StubResponse).body.days[today];
  assert.equal(day.arrival, false);
  assert.equal(day.departure, false);
});

test('결제가 꺼진 예약 요청도 Beds24 마감 날짜를 DB에 접수하지 않는다', async () => {
  const r = await requestBooking(new Request('http://localhost/api/public/bookings', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyId: 'legacy-id', checkIn: '2027-02-10', checkOut: '2027-02-11', guests: 2,
      name: 'Test', email: 'test@example.com', phone: '01012345678' }),
  }), { params: Promise.resolve({}) });
  assert.equal(r.status, 409);
  assert.equal((db.booking ?? []).length, 0);
});
