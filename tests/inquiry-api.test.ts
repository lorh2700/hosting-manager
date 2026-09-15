import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsManager, actAsCleaner, actAsAnonymous } from './stubs/auth';
import { makeRequest, resetFetch, installBeds24Mock } from './helpers/beds24-mock';
import { GET as SETTINGS_GET, PUT as SETTINGS_PUT } from '../app/api/properties/[id]/inquiry-automation/route';
import { PUT as PAUSE } from '../app/api/conversations/[id]/automation/route';
import { POST as SEND } from '../app/api/beds24/messages/send/route';
import { POST as WORK } from '../app/api/inquiry-automation/process/route';

beforeEach(() => {
  resetDb(); actAsAdmin();
  db.property = [{ id: 'p1', beds24PropId: '123', name: 'A' }];
  db.event = [{ id: 'e1', propertyId: 'p1', channelId: 'beds24', originalUid: '77' }];
  for (const key of ['OPENAI_API_KEY', 'CRON_SECRET', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PFID', 'SOLAPI_FROM', 'SOLAPI_TPL_INQUIRY_ESCALATED']) process.env[key] = 'test';
});
const config = { enabled: true, knowledge: '체크인은 오후 3시이며 체크아웃은 오전 11시입니다. 주차는 불가합니다.' };
async function call(handler: typeof SETTINGS_GET, body: unknown, id = 'p1') {
  return await handler(makeRequest(body), { params: Promise.resolve({ id }) }) as unknown as { status: number; body: any };
}

test('자동답변은 수신 설정이 있어야 시작되며 켠 시점의 기준일을 보존한다', async () => {
  assert.equal((await call(SETTINGS_PUT, config)).status, 400);
  db.inquiryNotificationSettings = [{ propertyId: 'p1', enabled: true, recipients: [{ name: '담당자', phone: '01012345678' }] }];
  assert.equal((await call(SETTINGS_PUT, config)).status, 200);
  const first = db.inquiryAutomationSettings[0].enabledAt;
  assert.ok(first instanceof Date);
  await call(SETTINGS_PUT, { ...config, knowledge: config.knowledge + '\n반려동물 동반 불가' });
  assert.equal(db.inquiryAutomationSettings[0].enabledAt, first);
  await call(SETTINGS_PUT, { ...config, enabled: false });
  assert.equal(db.inquiryAutomationSettings[0].enabledAt, null);
});

test('자동답변 설정과 대화 상태 변경은 해당 숙소 관리 권한이 필요하다', async () => {
  for (const actor of [() => actAsManager(['p2']), () => actAsCleaner(['p1']), actAsAnonymous]) {
    actor(); const expected = actor === actAsAnonymous ? 401 : 403;
    assert.equal((await call(SETTINGS_GET, {})).status, expected);
    assert.equal((await call(SETTINGS_PUT, config)).status, expected);
    assert.equal((await call(PAUSE, { paused: true }, 'e1')).status, expected);
  }
});

test('수동 답변 발송 API가 대화 자동답변을 중지한다', async () => {
  resetFetch();
  installBeds24Mock({ onMessages: () => new Response(JSON.stringify([{ success: true, new: { id: 999 } }]), { status: 201 }) });
  try {
    const response = await SEND(makeRequest({ eventId: 'e1', text: '직접 답변입니다.' }), { params: Promise.resolve({}) }) as unknown as { status: number; body: any };
    assert.equal(response.status, 200); assert.equal(response.body.deliveryStatus, 'sent');
    assert.equal(db.inquiryConversation[0].paused, true); assert.equal(db.inquiryConversation[0].sendToken, null);
  } finally { resetFetch(); }
});

test('백그라운드 처리 API는 로그인 세션만으로 실행할 수 없다', async () => {
  const response = await WORK(makeRequest({ mode: 'seed' }), { params: Promise.resolve({}) }) as unknown as { status: number };
  assert.equal(response.status, 401);
});
