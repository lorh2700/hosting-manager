import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous } from './stubs/auth';
import { makeRequest } from './helpers/beds24-mock';
import { GET, PUT } from '../app/api/properties/[id]/inquiry-notifications/route';
import { getInquiryNotificationRecipients } from '../lib/inquiry-notification-recipients';
const recipient = { userId: 'u1', name: '예약 담당자', phone: '01012345678' };
const selection = { enabled: true, recipients: [{ userId: 'u1' }] };
async function request(handler: typeof GET, body: unknown = {}, id = 'p1') {
  return await handler(makeRequest(body), { params: Promise.resolve({ id }) }) as unknown as { status: number; body: any };
}
beforeEach(() => {
  resetDb(); actAsAdmin();
  db.property = [{ id: 'p1' }, { id: 'p2' }];
  db.user = [
    { id: 'u1', displayName: '예약 담당자', email: 'staff@test', phone: '+82 10-1234-5678', role: 'manager', status: 'active' },
    { id: 'u2', displayName: '관리자', phone: '01098765432', role: 'admin', status: 'active' },
    { id: 'u3', displayName: '다른 숙소', phone: '01011112222', role: 'manager', status: 'active' },
    { id: 'u4', displayName: '정지', phone: '01011113333', role: 'admin', status: 'suspended' },
    { id: 'u5', displayName: '번호 없음', phone: null, role: 'admin', status: 'active' },
    { id: 'u6', displayName: '청소', phone: '01011114444', role: 'cleaner', status: 'active' },
  ];
  db.userProperty = [{ userId: 'u1', propertyId: 'p1' }, { userId: 'u3', propertyId: 'p2' }];
});
test('숙소 관리 권한이 있는 활성 회원만 표시한다', async () => {
  actAsManager(['p1']); const result = await request(GET);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.members.map((m: any) => m.userId).sort(), ['u1','u2','u5']);
  assert.equal(result.body.members.find((m: any) => m.userId === 'u1').phone, '01012345678');
  assert.equal(result.body.members.find((m: any) => m.userId === 'u5').phone, '');
});
test('회원 ID로 서버 연락처를 저장하며 숙소별 설정 및 해제를 유지한다', async () => {
  assert.equal((await request(PUT, selection)).status, 200);
  assert.deepEqual((await request(GET)).body.recipients, [recipient]);
  assert.deepEqual((await request(GET, {}, 'p2')).body.recipients, []);
  assert.deepEqual(await getInquiryNotificationRecipients('p1'), [recipient]);
  db.inquiryAutomationSettings = [{ propertyId:'p1', enabled:true }];
  await request(PUT, { ...selection, enabled:false });
  assert.deepEqual(await getInquiryNotificationRecipients('p1'), []);
  assert.equal(db.inquiryAutomationSettings[0].enabled, false);
  await request(PUT, { enabled:false, recipients:[] });
  assert.deepEqual((await request(GET)).body.recipients, []);
});
test('발송 시 회원 연락처 변경·정지·배정 해제를 반영한다', async () => {
  await request(PUT, selection);
  db.user[0].phone = '010-5555-6666'; db.user[0].displayName = '새 이름';
  assert.deepEqual(await getInquiryNotificationRecipients('p1'), [{ userId:'u1', name:'새 이름', phone:'01055556666' }]);
  db.user[0].status = 'suspended'; assert.deepEqual(await getInquiryNotificationRecipients('p1'), []);
  db.user[0].status = 'active'; db.userProperty = []; assert.deepEqual(await getInquiryNotificationRecipients('p1'), []);
});
test('관리 권한 없는 요청은 조회와 저장을 거부한다', async () => {
  await request(PUT, selection);
  for (const actor of [() => actAsManager(['p2']), () => actAsCleaner(['p1']), actAsAnonymous]) {
    actor(); for (const handler of [GET,PUT]) assert.equal((await request(handler, selection)).status, actor === actAsAnonymous ? 401 : 403);
  }
  assert.equal(db.inquiryNotificationSettings[0].enabled, true);
});
test('위조 연락처·부적격 회원·중복 수신자를 거부하고 기존 설정을 보존한다', async () => {
  await request(PUT, selection);
  for (const body of [null, [], {enabled:true,recipients:[]}, {enabled:true,recipients:[recipient]},
    ...['missing','u3','u4','u5','u6'].map(userId => ({enabled:true,recipients:[{userId}]})),
    {enabled:true,recipients:[{userId:'u1'},{userId:'u1'}]}, {...selection,propertyId:'p2'},
    {enabled:false,recipients:Array.from({length:11}, () => ({userId:'u2'}))},
  ]) assert.equal((await request(PUT, body)).status, 400);
  assert.deepEqual((await request(GET)).body.recipients, [recipient]);
});
test('없는 숙소·손상된 설정 및 기존 직접 입력 설정을 처리한다', async () => {
  assert.equal((await request(GET, {}, 'missing')).status,404);
  assert.equal((await request(PUT, selection, 'missing')).status,404);
  assert.deepEqual(await getInquiryNotificationRecipients('p2'),[]);
  db.inquiryNotificationSettings = [{propertyId:'p1',enabled:true,recipients:[{phone:'broken'}]}];
  assert.deepEqual(await getInquiryNotificationRecipients('p1'),[]);
  const legacy = {name:'기존 담당자',phone:'01012345678'};
  db.inquiryNotificationSettings[0].recipients = [legacy];
  assert.deepEqual(await getInquiryNotificationRecipients('p1'),[legacy]);
  assert.equal((await request(PUT,{enabled:true,recipients:[legacy]})).status,400);
});