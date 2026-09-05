import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFetchHandler, fetchLog, resetFetch, json } from './helpers/beds24-mock';
// 실제 발송 로직을 검증하므로 스텁('@/lib/notify')이 아니라 실제 모듈을 상대 경로로 가져온다.
import { notifyCleaningCancelled, TEMPLATES } from '../lib/notify';

// getNotifier() 는 첫 호출 때 env 를 읽으므로 그 전에 가짜 자격을 넣는다.
process.env.SOLAPI_API_KEY = 'k';
process.env.SOLAPI_API_SECRET = 's';
process.env.SOLAPI_PFID = 'p';
process.env.SOLAPI_FROM = '01000000000';

let responses: Array<{ status: number; body: unknown }> = [];
setFetchHandler(() => {
  const r = responses.shift() ?? { status: 200, body: { messageId: 'ok' } };
  return json(r.body, r.status);
});

const opts = { cleanerPhone: '010-1234-5678', cleanerName: '김청소', propertyName: '안온재', date: '2026-10-03' };

beforeEach(() => { resetFetch(); responses = []; });

test('청소 취소 알림톡: 템플릿 기본값과 변수 이름', async () => {
  assert.equal(TEMPLATES.CLEANING_CANCELLED, 'KA01TP2604271450581856f06opPxqMq');
  responses = [{ status: 200, body: { messageId: 'm1' } }];
  const r = await notifyCleaningCancelled({ ...opts, reason: 'deleted' });
  assert.equal(r?.ok, true);
  assert.equal(fetchLog.length, 1);
  const m = fetchLog[0].body.message;
  assert.equal(m.type, 'ATA');
  assert.equal(m.to, '01012345678');
  assert.equal(m.kakaoOptions.templateId, TEMPLATES.CLEANING_CANCELLED);
  assert.deepEqual(Object.keys(m.kakaoOptions.variables).sort(), ['#{숙소명}', '#{청소업자명}', '#{청소일}'].sort());
  assert.match(m.text, /청소 일정 취소/);
});

test('알림톡 요청이 거부되면 일반 문자로 대체 발송', async () => {
  responses = [
    { status: 400, body: { errorMessage: 'ValidationError: template variables' } },
    { status: 200, body: { messageId: 'sms-1' } },
  ];
  const r = await notifyCleaningCancelled({ ...opts, reason: 'reassigned' });
  assert.equal(r?.ok, true);
  assert.equal(r?.messageId, 'sms-1');
  assert.equal(fetchLog.length, 2);
  assert.ok(['SMS', 'LMS'].includes(fetchLog[1].body.message.type));
  assert.match(fetchLog[1].body.message.text, /다른 담당자에게 배정/);
});

test('전화번호가 없으면 발송하지 않는다', async () => {
  const r = await notifyCleaningCancelled({ ...opts, cleanerPhone: null, reason: 'unassigned' });
  assert.equal(r, null);
  assert.equal(fetchLog.length, 0);
});
