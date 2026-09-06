/**
 * 카메라 사진 유입 파이프라인 — 지점 판별, 중복, 시간대 게이트, 판정 → 신호·알림.
 * 업로드·AI 판정은 주입해서 네트워크 없이 검증한다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { notifyCalls, resetNotify, actAsAdmin } from './stubs/notify-and-auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';
import { ingestCameraImage } from '@/lib/camera-ingest';
import type { CameraVerdict, IncomingCameraImage } from '@/lib/camera-types';
import { isLeavingWithLuggage } from '@/lib/camera-types';
import { POST as CONFIRM } from '@/app/api/checkout/confirm/route';

const KST_1105 = new Date('2026-09-06T02:05:00Z'); // 11:05 KST
const KST_2000 = new Date('2026-09-06T11:00:00Z'); // 20:00 KST

const uploads: { filename: string; bucket: string }[] = [];
const upload = async (a: { filename: string; bucket: string }) => { uploads.push(a); return { ok: true as const, path: `p/${a.filename}` }; };
const leavingVerdict: CameraVerdict = { peoplePresent: true, personCount: 2, luggage: 'suitcase_or_large_bag', direction: 'toward_exit', likelyRole: 'guest', confidence: 0.9, summary: '캐리어 2개를 끌고 현관 쪽으로', model: 'test', judgedAt: KST_1105.toISOString() };
const stayingVerdict: CameraVerdict = { ...leavingVerdict, luggage: 'none', summary: '빈손으로 이동' };

function image(over: Partial<IncomingCameraImage> = {}): IncomingCameraImage {
  return {
    source: 'imap', messageId: 'm1', capturedAt: KST_1105,
    to: ['cam+byulha@gmail.com'], from: 'cam@gmail.com', subject: 'Reolink alarm', text: null,
    filename: 'snap.jpg', contentType: 'image/jpeg', buffer: new ArrayBuffer(8),
    ...over,
  };
}

beforeEach(() => {
  resetDb();
  resetNotify();
  uploads.length = 0;
  db.user = [{ id: 'host-1', email: 'host@test', role: 'admin', phone: '01011112222', displayName: '도영' }];
  db.property = [
    { id: 'p1', name: '별하재', ownerId: 'host-1', slug: 'byulha', welcomepadKey: 'byulha', cameraName: '별하재 복도', cameraNotes: '왼쪽이 현관' },
    { id: 'p2', name: '안온재', ownerId: 'host-1', slug: 'anon', welcomepadKey: 'anon', cameraName: null, cameraNotes: null },
  ];
  db.event = [{ id: 'ev-1', propertyId: 'p1', type: 'reservation', startDate: '2026-09-04', endDate: '2026-09-06' }];
  db.cleaner = [{ id: 'cl-1', name: '민들레', phone: '01033334444', ownerId: 'host-1', notifyNewOpen: true }];
  db.cleaning = [{ id: 'c1', propertyId: 'p1', date: '2026-09-06', cleanerId: 'cl-1', status: 'pending' }];
});

test('판정 규칙: 캐리어 + 현관 방향 + 게스트 + 확신 0.7 이상일 때만 퇴실', () => {
  assert.equal(isLeavingWithLuggage(leavingVerdict), true);
  assert.equal(isLeavingWithLuggage({ ...leavingVerdict, confidence: 0.5 }), false);
  assert.equal(isLeavingWithLuggage({ ...leavingVerdict, likelyRole: 'staff' }), false);
  assert.equal(isLeavingWithLuggage({ ...leavingVerdict, direction: 'toward_rooms' }), false);
  assert.equal(isLeavingWithLuggage({ ...leavingVerdict, luggage: 'small_bag' }), false);
});

test('+태그로 지점을 찾고, 체크아웃 시간대면 판정해 신호와 호스트 알림을 남긴다', async () => {
  const r = await ingestCameraImage(image(), { upload, judge: async () => leavingVerdict });
  assert.equal(r.status, 'stored');
  assert.equal(r.propertyId, 'p1');
  assert.equal(r.judged, true);
  assert.equal(r.leaving, true);
  assert.equal(r.notified, true);
  assert.equal(uploads[0].bucket, 'camera-snapshots');
  assert.ok(uploads[0].filename.startsWith('p1/2026-09-06/'));
  assert.equal(db.cameraSnapshot.length, 1);
  assert.equal(db.cameraSnapshot[0].leaving, true);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(db.checkoutSignal[0].kind, 'camera');
  assert.equal(notifyCalls.checkoutCandidate.length, 1);
  assert.equal(notifyCalls.checkoutCandidate[0].phone, '01011112222');
  assert.match(notifyCalls.checkoutCandidate[0].summary, /캐리어/);
});

test('카메라 이름이 제목에 있으면 그 지점으로, 어느 쪽도 없으면 저장하지 않는다', async () => {
  const byName = await ingestCameraImage(image({ to: ['cam@gmail.com'], subject: '[별하재 복도] Person detected' }), { upload, judge: async () => stayingVerdict });
  assert.equal(byName.status, 'stored');
  assert.equal(byName.propertyId, 'p1');

  const none = await ingestCameraImage(image({ messageId: 'm2', to: ['cam@gmail.com'], subject: 'unknown' }), { upload, judge: async () => stayingVerdict });
  assert.equal(none.status, 'unmapped');
  assert.equal(uploads.length, 1);
});

test('같은 메일은 두 번 저장하지 않는다', async () => {
  await ingestCameraImage(image(), { upload, judge: async () => stayingVerdict });
  const again = await ingestCameraImage(image(), { upload, judge: async () => stayingVerdict });
  assert.equal(again.status, 'duplicate');
  assert.equal(db.cameraSnapshot.length, 1);
});

test('체크아웃 시간대 밖이거나 오늘 퇴실 예정이 없으면 사진만 저장하고 판정하지 않는다', async () => {
  let judged = 0;
  const judge = async () => { judged += 1; return leavingVerdict; };
  const night = await ingestCameraImage(image({ capturedAt: KST_2000 }), { upload, judge });
  assert.equal(night.status, 'stored');
  assert.equal(night.judged, false);

  const noCheckout = await ingestCameraImage(image({ messageId: 'm3', to: ['cam+anon@gmail.com'] }), { upload, judge });
  assert.equal(noCheckout.propertyId, 'p2');
  assert.equal(noCheckout.judged, false);
  assert.equal(judged, 0);
});

test('퇴실 판정이 하루에 여러 번 나와도 호스트 알림은 한 번', async () => {
  await ingestCameraImage(image({ messageId: 'a' }), { upload, judge: async () => leavingVerdict });
  await ingestCameraImage(image({ messageId: 'b', capturedAt: new Date(KST_1105.getTime() + 60_000) }), { upload, judge: async () => leavingVerdict });
  assert.equal(db.cameraSnapshot.filter(s => s.leaving).length, 2);
  assert.equal(db.checkoutSignal.length, 1);
  assert.equal(notifyCalls.checkoutCandidate.length, 1);
});

test('호스트 확인: host 신호 + 배정 담당자 알림, 호스트 본인에게는 안 보냄, 두 번째는 중복', async () => {
  actAsAdmin();
  const res = await callRoute(CONFIRM, makeRequest({ propertyId: 'p1', date: '2026-09-06' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.confirmed, true);
  assert.equal(res.body.confirmedBy, 'host');
  assert.equal(res.body.notified, 1);
  assert.deepEqual(notifyCalls.checkout.map(c => c.phone), ['01033334444']);

  const again = await callRoute(CONFIRM, makeRequest({ propertyId: 'p1', date: '2026-09-06' }));
  assert.equal(again.body.duplicate, true);
  assert.equal(notifyCalls.checkout.length, 1);
});
