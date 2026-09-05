import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installBeds24Mock, json, fetchLog, resetFetch, tokenCalls, setFetchHandler } from './helpers/beds24-mock';
import { resetDb } from './stubs/prisma';
import { beds24Get, getLastBeds24CreditInfo, invalidateBeds24Token, Beds24ApiError } from '@/lib/beds24';

// 토큰은 메모리와 DB(스텁) 양쪽에 캐시되므로 둘 다 비운다.
beforeEach(() => { resetFetch(); resetDb(); invalidateBeds24Token(); });

test('크레딧 헤더(x-five-min-limit-*)를 읽어 마지막 상태로 보관한다', async () => {
  setFetchHandler((u) => u.pathname.endsWith('/authentication/token')
    ? json({ token: 'tok', expiresIn: 86400 })
    : json({ success: true, data: [] }, 200, { 'x-five-min-limit-remaining': '42', 'x-five-min-limit-resets-in': '120', 'x-request-cost': '1' }));
  await beds24Get('/bookings', { propertyId: '1' });
  const info = getLastBeds24CreditInfo();
  assert.equal(info?.remaining, 42);
  assert.equal(info?.resetInSec, 120);
  assert.equal(info?.cost, 1);
});

test('리셋까지 오래 남은 429 는 기다리지 않고 즉시 일시 오류로 넘긴다', async () => {
  setFetchHandler((u) => u.pathname.endsWith('/authentication/token')
    ? json({ token: 'tok', expiresIn: 86400 })
    : json({ success: false, code: 429, error: 'Credit limit exceeded' }, 429, { 'x-five-min-limit-resets-in': '200' }));
  const started = Date.now();
  await assert.rejects(
    () => beds24Get('/bookings', { propertyId: '1' }),
    (e: unknown) => e instanceof Beds24ApiError && e.status === 429 && e.isTransient,
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(fetchLog.filter(l => l.url.includes('/bookings')).length, 1, '재시도 없음');
});

test('리셋이 임박한 429 는 한 번 기다렸다 재시도한다', async () => {
  let n = 0;
  setFetchHandler((u) => {
    if (u.pathname.endsWith('/authentication/token')) return json({ token: 'tok', expiresIn: 86400 });
    return ++n === 1
      ? json({ success: false, code: 429 }, 429, { 'x-five-min-limit-resets-in': '1' })
      : json({ success: true, data: [{ id: 1 }] });
  });
  const data = await beds24Get('/bookings', { propertyId: '1' });
  assert.equal(data.data[0].id, 1);
  assert.equal(fetchLog.filter(l => l.url.includes('/bookings')).length, 2);
});

test('401 이면 토큰을 강제 갱신해 한 번 더 시도한다', async () => {
  installBeds24Mock({ validTokens: ['tok-2'] });
  const data = await beds24Get('/bookings', { id: '123' });
  assert.equal(data.data[0].id, 123);
  assert.equal(tokenCalls().length, 2);
  assert.ok(fetchLog.some(l => l.status === 401));
});
