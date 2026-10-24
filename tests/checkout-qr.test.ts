import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { checkoutQrToken, verifyCheckoutQr } from '../lib/checkout-qr';
import { POST } from '../app/api/public/guest-checkout/route';
import { GET as QR } from '../app/api/checkout/qr/route';
import { recordCheckoutSignal } from '../lib/checkout';
import { db, prisma, prismaOverrides, resetDb } from './stubs/prisma';
import { notifyCalls, resetNotify, actAsAdmin, actAsAnonymous } from './stubs/notify-and-auth';
import { callRoute } from './helpers/beds24-mock';
import { todayKst, addDaysToDateStr } from '../lib/dates';
import { autoConfirmGuestCheckout } from '../lib/guest-checkout-client';
import { installGuestLinkRegistry } from './helpers/guest-link-registry';
import { createGuestLinkStore, guestLinkHash } from '../lib/guest-link-store';

const propertyId = 'qr-property';
let registry: ReturnType<typeof installGuestLinkRegistry>;
async function request(action: string, extra: Record<string, unknown> = {}) {
  return new Request('https://voidanchae.com/api/public/guest-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await checkoutQrToken(propertyId), action, viewedDate: todayKst(), confirmedDeparture: true, ...extra }) });
}
function legacyToken(id: string, secret: string) {
  const encoded = Buffer.from(id).toString('base64url');
  const signature = createHmac('sha256', secret).update(`void-guest-checkout-v1:${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
}
beforeEach(() => {
  resetDb(); resetNotify();
  registry = installGuestLinkRegistry();
  db.user = [{ id: 'host-1', email: 'host@test', role: 'admin', phone: '01011112222', displayName: 'Host' }];
  db.property = [{ id: propertyId, name: '운와당', ownerId: 'host-1', status: 'active' }];
  db.event = [{ id: 'event-1', propertyId, type: 'reservation', endDate: todayKst(), startDate: addDaysToDateStr(todayKst(), -2) }];
  db.user.push(...[{ id: 'cleaner-1', ownerId: 'host-1', name: 'Cleaner', phone: '01033334444', notifyNewOpen: true }].map(u => ({ ...u, displayName: u.name, role: 'cleaner', status: 'active' })));
  db.userProperty = [{ userId: 'cleaner-1', propertyId: 'p1' }];
  db.cleaning = [{ id: 'cleaning-1', propertyId, date: todayKst(), cleanerId: 'cleaner-1', status: 'pending' }];
});
afterEach(async () => { await registry.close(); });

test('QR 발급은 난수 링크를 저장하고 발급된 각 링크와 숙소 연결을 유지한다', async () => {
  const token = await checkoutQrToken(propertyId);
  const next = await checkoutQrToken(propertyId);
  assert.match(token, /^q1_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(next, token);
  assert.equal(await verifyCheckoutQr(token), propertyId);
  assert.equal(await verifyCheckoutQr(next), propertyId);
  assert.equal(await verifyCheckoutQr(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(await verifyCheckoutQr('invalid'), null);
  assert.equal(await verifyCheckoutQr('a'.repeat(1000)), null);
});

test('새 QR과 검증하여 등록한 구형 QR은 JWT 키 변경과 삭제 후에도 유지된다', async () => {
  const previousSecret = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'old-checkout-test-key';
    const token = await checkoutQrToken(propertyId);
    const oldToken = legacyToken(propertyId, process.env.JWT_SECRET);
    assert.equal(await verifyCheckoutQr(oldToken), propertyId);
    process.env.JWT_SECRET = 'new-checkout-test-key';
    assert.equal(await verifyCheckoutQr(token), propertyId);
    assert.equal(await verifyCheckoutQr(oldToken), propertyId);
    delete process.env.JWT_SECRET;
    assert.equal(await verifyCheckoutQr(token), propertyId);
    assert.equal(await verifyCheckoutQr(oldToken), propertyId);
    assert.equal(await verifyCheckoutQr(await checkoutQrToken(propertyId)), propertyId);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('등록되지 않은 구형 QR은 현재 키로 서명을 검증할 수 있어야 한다', async () => {
  const previousSecret = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'current-checkout-test-key';
    assert.equal(await verifyCheckoutQr(legacyToken(propertyId, 'lost-checkout-test-key')), null);
    assert.equal(await verifyCheckoutQr(legacyToken('another-property', process.env.JWT_SECRET)), 'another-property');
    delete process.env.JWT_SECRET;
    assert.equal(await verifyCheckoutQr(legacyToken(propertyId, 'current-checkout-test-key')), null);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('구형 QR 복구가 추가되어도 잘못된 형식과 서명 누락은 거부한다', async () => {
  const token = legacyToken(propertyId, process.env.JWT_SECRET!);
  for (const invalid of [null, {}, '', token.split('.')[0], `${token}.extra`, ` ${token}`, `${token}\n`, `${token}=`, '.signature']) {
    assert.equal(await verifyCheckoutQr(invalid), null);
  }
  assert.equal(await verifyCheckoutQr(legacyToken('invalid/property', process.env.JWT_SECRET!)), null);
});

test('폐기된 구형 QR은 현재 서명이 유효해도 다시 등록하거나 사용할 수 없다', async () => {
  const token = legacyToken(propertyId, process.env.JWT_SECRET!);
  assert.equal(await verifyCheckoutQr(token), propertyId);
  await (await registry.sql()).query('UPDATE guest_link_tokens SET revoked_at=now() WHERE token_hash=$1', [guestLinkHash(token)]);
  assert.equal(await verifyCheckoutQr(token), null);
  assert.equal(await createGuestLinkStore(prisma).registerCheckout(token, propertyId), false);
  assert.equal((await callRoute(POST, await request('confirm', { token }))).status, 403);
  assert.equal((db.checkoutSignal ?? []).length, 0);
});

test('다른 용도로 저장된 링크는 유효한 구형 QR 서명이 있어도 체크아웃에 쓰지 못한다', async () => {
  const token = legacyToken(propertyId, process.env.JWT_SECRET!);
  await createGuestLinkStore(prisma).registerInvitation(token, { kind: 'event', id: '8ebfbba8-7aef-4b77-83fb-4d4f99f8a2dc', propertyId, expires: Date.now() + 86_400_000 });
  assert.equal(await verifyCheckoutQr(token), null);
});

test('발급 기록 조회가 실패하면 유효한 구형 서명으로도 검증을 우회하지 않는다', async () => {
  const token = legacyToken(propertyId, process.env.JWT_SECRET!);
  prismaOverrides.$queryRaw = async () => { throw new Error('database unavailable'); };
  await assert.rejects(verifyCheckoutQr(token), /database unavailable/);
});

test('QR 스캔 상태 조회는 예약자 정보·신호 상세를 노출하거나 알림을 보내지 않는다', async () => {
  const response = await callRoute(POST, await request('status'));
  assert.equal(response.status, 200);
  assert.equal(response.body.eligible, true);
  assert.equal(response.body.propertyName, '운와당');
  assert.equal(response.body.signals, undefined);
  assert.equal(response.body.eventId, undefined);
  assert.equal((db.checkoutSignal ?? []).length, 0);
  assert.equal(notifyCalls.checkout.length, 0);
});

test('완료 클릭은 오늘 퇴실에 연결되고 호스트·담당자에게 한 번만 알린다', async () => {
  const first = await callRoute(POST, await request('confirm'));
  const again = await callRoute(POST, await request('confirm'));
  assert.equal(first.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(db.checkoutSignal[0].eventId, 'event-1');
  assert.equal(db.checkoutSignal[0].note, 'guest_qr');
  assert.deepEqual(notifyCalls.checkout.map(c => c.phone).sort(), ['01011112222', '01033334444']);
});

test('동시에 QR 완료 요청이 들어와도 기록과 알림은 한 번만 생성한다', async () => {
  const token = await checkoutQrToken(propertyId);
  const requests = await Promise.all([request('confirm', { token }), request('confirm', { token })]);
  const responses = await Promise.all(requests.map(req => callRoute(POST, req)));

  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(responses.filter(response => response.body.duplicate).length, 1);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(db.checkoutSignal[0].kind, 'guest_pad');
  assert.deepEqual(notifyCalls.checkout.map(call => call.phone).sort(), ['01011112222', '01033334444']);
});

test('잘못된 QR·퇴실 미확인·오래 열린 화면은 완료할 수 없다', async () => {
  assert.equal((await callRoute(POST, await request('confirm', { token: 'bad' }))).status, 403);
  assert.equal((await callRoute(POST, await request('confirm', { confirmedDeparture: false }))).status, 400);
  assert.equal((await callRoute(POST, await request('confirm', { viewedDate: addDaysToDateStr(todayKst(), -1) }))).status, 409);
  assert.equal((db.checkoutSignal ?? []).length, 0);
});

test('오늘 퇴실 없음·여러 예약·비활성 숙소는 확인을 차단한다', async () => {
  db.event = [];
  assert.equal((await callRoute(POST, await request('status'))).body.eligible, false);
  assert.equal((await callRoute(POST, await request('confirm', { date: '2027-01-01', eventId: 'fake' }))).status, 409);
  db.event = [1, 2].map(i => ({ id: `e${i}`, propertyId, type: 'reservation', endDate: todayKst() }));
  assert.equal((await callRoute(POST, await request('confirm'))).status, 409);
  db.property[0].status = 'closed';
  assert.equal((await callRoute(POST, await request('status'))).status, 404);
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
  assert.equal(await verifyCheckoutQr(url.hash.slice(1)), propertyId);
});

test('동일한 확인 신호를 동시에 저장하면 기존 확인으로 처리한다', async () => {
  const results = await Promise.all([1, 2].map(() => recordCheckoutSignal({ propertyId, date: todayKst(), kind: 'guest_pad' })));
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  assert.equal(results.filter(r => r.newlyConfirmed).length, 1);
});

test('고유키 충돌 뒤에는 롤백된 트랜잭션 밖에서 이미 커밋된 확인을 읽는다', async () => {
  const input = { propertyId, date: todayKst(), kind: 'guest_pad' as const };
  const first = await recordCheckoutSignal(input);
  const signals = prisma.checkoutSignal;
  prismaOverrides.checkoutSignal = { ...signals, findMany: async () => [] };

  const retry = await recordCheckoutSignal(input);

  assert.equal(retry.signal.id, first.signal.id);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.newlyConfirmed, false);
  assert.equal(db.checkoutSignal.length, 1);
});

test('호스트와 게스트가 동시에 확인해도 최초 체크아웃은 한 건으로 판정한다', async () => {
  const results = await Promise.all((['host', 'guest_pad'] as const).map(kind =>
    recordCheckoutSignal({ propertyId, date: todayKst(), kind })));

  assert.deepEqual(db.checkoutSignal.map(signal => signal.kind).sort(), ['guest_pad', 'host']);
  assert.equal(results.filter(result => result.duplicate).length, 0);
  assert.equal(results.filter(result => result.newlyConfirmed).length, 1);
});

test('QR 페이지 자동 흐름은 버튼 없이 확인하고 다시 열어도 알림을 중복 발송하지 않는다', async () => {
  const actions: string[] = [];
  const send: typeof fetch = async (_url, init) => {
    actions.push(JSON.parse(String(init?.body)).action);
    const response = await callRoute(POST, new Request('https://voidanchae.com/api/public/guest-checkout', init));
    return Response.json(response.body, { status: response.status });
  };
  const token = await checkoutQrToken(propertyId);
  const signal = new AbortController().signal;
  const first = await autoConfirmGuestCheckout(token, signal, send);
  assert.equal(first.confirmed, true);
  assert.deepEqual(actions, ['status', 'confirm']);
  assert.equal((await autoConfirmGuestCheckout(token, signal, send)).confirmed, true);
  assert.deepEqual(actions, ['status', 'confirm', 'status']);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(notifyCalls.checkout.length, 2); // One per host and assigned cleaner.
});

test('자동 흐름도 오늘 예약이 없으면 확인 요청을 보내지 않는다', async () => {
  db.event = [];
  const actions: string[] = [];
  const send: typeof fetch = async (_url, init) => {
    actions.push(JSON.parse(String(init?.body)).action);
    const response = await callRoute(POST, new Request('https://voidanchae.com/api/public/guest-checkout', init));
    return Response.json(response.body, { status: response.status });
  };
  const result = await autoConfirmGuestCheckout(await checkoutQrToken(propertyId), new AbortController().signal, send);
  assert.equal(result.confirmed, false);
  assert.deepEqual(actions, ['status']);
  assert.equal(notifyCalls.checkout.length, 0);
});

test('자동 확인 응답이 유실돼도 재시도는 저장된 확인을 읽고 추가 발송하지 않는다', async () => {
  let loseConfirmResponse = true;
  const send: typeof fetch = async (_url, init) => {
    const response = await callRoute(POST, new Request('https://voidanchae.com/api/public/guest-checkout', init));
    if (JSON.parse(String(init?.body)).action === 'confirm' && loseConfirmResponse) {
      loseConfirmResponse = false;
      throw new Error('network lost');
    }
    return Response.json(response.body, { status: response.status });
  };
  const token = await checkoutQrToken(propertyId);
  const signal = new AbortController().signal;
  await assert.rejects(autoConfirmGuestCheckout(token, signal, send), /network lost/);
  assert.equal((await autoConfirmGuestCheckout(token, signal, send)).confirmed, true);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(notifyCalls.checkout.length, 2);
});
