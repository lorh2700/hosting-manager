import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous } from './stubs/auth';
import { makeRequest } from './helpers/beds24-mock';
import { GET, PUT } from '../app/api/properties/[id]/inquiry-notifications/route';
import { getInquiryNotificationRecipients } from '../lib/inquiry-notification-recipients';

const recipient = { name: '예약 담당자', phone: '01012345678' };
async function request(handler: typeof GET, body: unknown = {}, id = 'p1') {
  return await handler(makeRequest(body), { params: Promise.resolve({ id }) }) as unknown as { status: number; body: any };
}

beforeEach(() => {
  resetDb();
  actAsAdmin();
  db.property = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
});

test('알림 설정: 저장 후 다시 조회, 숙소별 분리, 수정과 삭제가 수신 대상에 반영된다', async () => {
  actAsManager(['p1', 'p2']);
  assert.deepEqual((await request(GET)).body, { enabled: false, recipients: [] });
  const first = await request(PUT, { enabled: true, recipients: [{ name: ' 예약 담당자 ', phone: '+82 10-1234-5678' }, { name: '야간 담당', phone: '010-9876-5432' }] });
  assert.equal(first.status, 200);
  assert.deepEqual((await request(GET)).body.recipients[0], recipient);
  assert.deepEqual((await request(GET, {}, 'p2')).body.recipients, []);
  await request(PUT, { enabled: true, recipients: [recipient] });
  assert.deepEqual(await getInquiryNotificationRecipients('p1'), [recipient]);
  assert.equal(db.inquiryNotificationSettings.length, 1);
  await request(PUT, { enabled: false, recipients: [recipient] });
  assert.deepEqual(await getInquiryNotificationRecipients('p1'), []);
  assert.deepEqual((await request(GET)).body.recipients, [recipient]);
  await request(PUT, { enabled: false, recipients: [] });
  assert.deepEqual((await request(GET)).body.recipients, []);
});

test('알림 수신자의 연락처 조회와 수정 모두 관리 권한 필요', async () => {
  await request(PUT, { enabled: true, recipients: [recipient] });
  for (const actor of [() => actAsManager(['p2']), () => actAsCleaner(['p1'])]) {
    actor();
    for (const handler of [GET, PUT]) assert.equal((await request(handler, { enabled: false, recipients: [] })).status, 403);
  }
  actAsAnonymous();
  for (const handler of [GET, PUT]) assert.equal((await request(handler)).status, 401);
  assert.equal(db.inquiryNotificationSettings[0].enabled, true);
});

test('알림 설정: 잘못된 요청과 정규화 후 중복 번호는 기존 설정을 덮어쓰지 않는다', async () => {
  await request(PUT, { enabled: true, recipients: [recipient] });
  for (const body of [
    null, [], { enabled: 'true', recipients: [] },
    { enabled: true, recipients: [] },
    { enabled: true, recipients: [{ ...recipient, name: '   ' }] },
    { enabled: false, recipients: [{ ...recipient, phone: '010abc12345678' }] },
    { enabled: true, recipients: [{ ...recipient, phone: '0212345678' }] },
    { enabled: true, recipients: [recipient, { ...recipient, phone: '+82 10 1234 5678' }] },
    { enabled: false, recipients: Array.from({ length: 11 }, (_, i) => ({ ...recipient, phone: `010123456${String(i).padStart(2, '0')}` })) },
    { enabled: true, recipients: [recipient], propertyId: 'p2' },
  ]) assert.equal((await request(PUT, body)).status, 400, JSON.stringify(body));
  assert.deepEqual((await request(GET)).body, { enabled: true, recipients: [recipient] });
});

test('없는 숙소는 404이며 미설정·손상된 설정은 임의 수신자로 대체하지 않는다', async () => {
  assert.equal((await request(GET, {}, 'missing')).status, 404);
  assert.equal((await request(PUT, { enabled: true, recipients: [recipient] }, 'missing')).status, 404);
  assert.deepEqual(await getInquiryNotificationRecipients('p2'), []);
  db.inquiryNotificationSettings = [{ propertyId: 'p1', enabled: true, recipients: [{ phone: 'broken' }] }];
  assert.deepEqual(await getInquiryNotificationRecipients('p1'), []);
});
