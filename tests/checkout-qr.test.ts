import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutQrToken, verifyCheckoutQr } from '../lib/checkout-qr';
import { POST } from '../app/api/public/guest-checkout/route';
import { GET as QR } from '../app/api/checkout/qr/route';
import { recordCheckoutSignal } from '../lib/checkout';
import { db, resetDb } from './stubs/prisma';
import { notifyCalls, resetNotify, actAsAdmin, actAsAnonymous } from './stubs/notify-and-auth';
import { callRoute } from './helpers/beds24-mock';
import { todayKst, addDaysToDateStr } from '../lib/dates';

const propertyId = 'qr-property';
function request(action: string, extra: Record<string, unknown> = {}) {
  return new Request('https://voidanchae.com/api/public/guest-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: checkoutQrToken(propertyId), action, viewedDate: todayKst(), confirmedDeparture: true, ...extra }) });
}
beforeEach(() => {
  resetDb(); resetNotify();
  db.user = [{ id: 'host-1', email: 'host@test', role: 'admin', phone: '01011112222', displayName: 'Host' }];
  db.property = [{ id: propertyId, name: '운와당', ownerId: 'host-1', status: 'active' }];
  db.event = [{ id: 'event-1', propertyId, type: 'reservation', endDate: todayKst(), startDate: addDaysToDateStr(todayKst(), -2) }];
  db.cleaner = [{ id: 'cleaner-1', ownerId: 'host-1', name: 'Cleaner', phone: '01033334444', notifyNewOpen: true }];
  db.cleaning = [{ id: 'cleaning-1', propertyId, date: todayKst(), cleanerId: 'cleaner-1', status: 'pending' }];
});

test('고정 QR은 같은 숙소에 안정적으로 발급되며 변조된 서명은 거부한다', () => {
  const token = checkoutQrToken(propertyId);
  assert.equal(checkoutQrToken(propertyId), token);
  assert.equal(verifyCheckoutQr(token), propertyId);
  assert.equal(verifyCheckoutQr(`${Buffer.from('another-property').toString('base64url')}.${token.split('.')[1]}`), null);
  assert.equal(verifyCheckoutQr('invalid'), null);
  assert.equal(verifyCheckoutQr('a'.repeat(1000)), null);
});

test('QR 스캔 상태 조회는 예약자 정보·신호 상세를 노출하거나 알림을 보내지 않는다', async () => {
  const response = await callRoute(POST, request('status'));
  assert.equal(response.status, 200);
  assert.equal(response.body.eligible, true);
  assert.equal(response.body.propertyName, '운와당');
  assert.equal(response.body.signals, undefined);
  assert.equal(response.body.eventId, undefined);
  assert.equal((db.checkoutSignal ?? []).length, 0);
  assert.equal(notifyCalls.checkout.length, 0);
});

test('완료 클릭은 오늘 퇴실에 연결되고 호스트·담당자에게 한 번만 알린다', async () => {
  const first = await callRoute(POST, request('confirm'));
  const again = await callRoute(POST, request('confirm'));
  assert.equal(first.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(db.checkoutSignal[0].eventId, 'event-1');
  assert.equal(db.checkoutSignal[0].note, 'guest_qr');
  assert.deepEqual(notifyCalls.checkout.map(c => c.phone).sort(), ['01011112222', '01033334444']);
});

test('잘못된 QR·퇴실 미확인·오래 열린 화면은 완료할 수 없다', async () => {
  assert.equal((await callRoute(POST, request('confirm', { token: 'bad' }))).status, 403);
  assert.equal((await callRoute(POST, request('confirm', { confirmedDeparture: false }))).status, 400);
  assert.equal((await callRoute(POST, request('confirm', { viewedDate: addDaysToDateStr(todayKst(), -1) }))).status, 409);
  assert.equal((db.checkoutSignal ?? []).length, 0);
});

test('오늘 퇴실 없음·여러 예약·비활성 숙소는 확인을 차단한다', async () => {
  db.event = [];
  assert.equal((await callRoute(POST, request('status'))).body.eligible, false);
  assert.equal((await callRoute(POST, request('confirm', { date: '2027-01-01', eventId: 'fake' }))).status, 409);
  db.event = [1, 2].map(i => ({ id: `e${i}`, propertyId, type: 'reservation', endDate: todayKst() }));
  assert.equal((await callRoute(POST, request('confirm'))).status, 409);
  db.property[0].status = 'closed';
  assert.equal((await callRoute(POST, request('status'))).status, 404);
});

test('QR 발급은 관리자 권한이 필요하고 서버에서 PNG를 생성한다', async () => {
  actAsAnonymous();
  const req = () => new Request(`https://voidanchae.com/api/checkout/qr?propertyId=${propertyId}`);
  assert.equal((await callRoute(QR, req())).status, 401);
  actAsAdmin();
  const response = await callRoute(QR, req());
  assert.equal(response.status, 200);
  assert.match(response.body.image, /^data:image\/png;base64,/);
  const url = new URL(response.body.url);
  assert.equal(url.pathname, '/guest-checkout');
  assert.equal(verifyCheckoutQr(url.hash.slice(1)), propertyId);
});

test('동시 중복 저장의 고유키 충돌은 이미 저장된 확인으로 처리한다', async () => {
  const results = await Promise.all([1, 2].map(() => recordCheckoutSignal({ propertyId, date: todayKst(), kind: 'guest_pad' })));
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  assert.equal(results.filter(r => r.newlyConfirmed).length, 1);
});
