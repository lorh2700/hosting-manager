import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous } from './stubs/auth';
import { makeRequest, fetchLog, resetFetch } from './helpers/beds24-mock';
import { GET as TARGET } from '../app/api/conversations/[id]/reply-target/route';
import { POST as SEND } from '../app/api/beds24/messages/send/route';
import { conversationReplyTarget, messageDeliveryPresentation } from '../lib/message-presentation';

beforeEach(() => {
  resetDb(); resetFetch(); actAsAdmin();
  db.event = [{ id: 'e1', propertyId: 'p1', source: 'booking', channelId: 'beds24', originalUid: '77' }];
});

test('Beds24 접수와 플랫폼 전달 완료를 서로 다른 상태로 보여준다', () => {
  const accepted = messageDeliveryPresentation({ sender: 'host', deliveryStatus: 'sent' });
  assert.equal(accepted?.label, 'Beds24 접수 완료');
  assert.match(accepted!.detail, /플랫폼 도착은 확인되지/);
  assert.equal(messageDeliveryPresentation({ sender: 'host', deliveryStatus: 'delivered' })?.label, '플랫폼 전달 완료');
  assert.equal(messageDeliveryPresentation({ sender: 'host', deliveryStatus: 'unknown' })?.tone, 'warning');
  assert.match(messageDeliveryPresentation({ sender: 'host', deliveryStatus: 'failed' })!.detail, /기록은 저장/);
  assert.equal(messageDeliveryPresentation({ sender: 'guest' }), null);
});

test('내부 메모는 성공한 게스트 답장으로 표시하지 않는다', () => {
  for (const metadata of [{ deliveryStatus: 'local_only' }, { type: 'memo' }, { beds24MessageType: 'internalNote' }]) {
    const status = messageDeliveryPresentation({ sender: 'host', ...metadata });
    assert.equal(status?.label, '내부 메모');
    assert.match(status!.detail, /발송되지/);
  }
  assert.equal(messageDeliveryPresentation({ sender: 'host' })?.label, '전달 상태 미확인');
});

test('답장 경로는 예약 플랫폼과 실제 발송 가능한 Beds24 예약을 함께 확인한다', () => {
  assert.deepEqual(conversationReplyTarget('booking', 'beds24', '77'), { isBeds24: true, label: 'Booking.com 예약 메시지' });
  assert.equal(conversationReplyTarget('airbnb', 'beds24', '77').label, 'Airbnb 예약 메시지');
  assert.match(conversationReplyTarget('unknown-channel', 'beds24', '77').label, /플랫폼 미확인/);
  assert.match(conversationReplyTarget('booking', 'beds24', 'ical-id').label, /내부 메모/);
  assert.equal(conversationReplyTarget('booking', 'direct', '77').isBeds24, false);
});

test('선택 대화의 경로 조회는 실제 예약 데이터를 사용하고 외부 호출을 하지 않는다', async () => {
  const result = await TARGET(makeRequest({}), { params: Promise.resolve({ id: 'e1' }) }) as unknown as { status: number; body: any };
  assert.equal(result.status, 200);
  assert.equal(result.body.label, 'Booking.com 예약 메시지');
  assert.equal(result.body.isBeds24, true);
  assert.equal(fetchLog.length, 0);
  assert.equal('originalUid' in result.body, false);
});

test('예약을 관리할 권한이 없으면 연락 경로를 조회할 수 없다', async () => {
  for (const [actor, expected] of [[() => actAsManager(['p2']), 403], [() => actAsCleaner(['p1']), 403], [actAsAnonymous, 401]] as const) {
    actor();
    const result = await TARGET(makeRequest({}), { params: Promise.resolve({ id: 'e1' }) }) as unknown as { status: number };
    assert.equal(result.status, expected);
  }
});

test('직접 예약의 연락 경로와 저장 결과를 내부 메모로 일치시킨다', async () => {
  db.booking = [{ id: 'b1', propertyId: 'p1', source: 'direct', name: '게스트' }];
  const target = await TARGET(makeRequest({}), { params: Promise.resolve({ id: 'b1' }) }) as unknown as { status: number; body: any };
  assert.equal(target.status, 200); assert.equal(target.body.isBeds24, false);
  assert.match(target.body.label, /내부 메모/);
  const saved = await SEND(makeRequest({ eventId: 'b1', text: '직원만 확인할 메모' }), { params: Promise.resolve({}) }) as unknown as { status: number; body: any };
  assert.equal(saved.status, 200); assert.equal(saved.body.deliveryStatus, 'local_only');
  assert.equal(db.message[0].type, 'memo'); assert.equal(fetchLog.length, 0);
});

test('삭제되었거나 존재하지 않는 예약은 연락 경로 미확인으로 처리된다', async () => {
  const result = await TARGET(makeRequest({}), { params: Promise.resolve({ id: 'missing' }) }) as unknown as { status: number };
  assert.equal(result.status, 404);
});
