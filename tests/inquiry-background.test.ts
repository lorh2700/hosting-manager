import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setFetchHandler, resetFetch, fetchLog, json } from './helpers/beds24-mock';
import background from '../netlify/functions/beds24-messages-background';
import cron from '../netlify/functions/beds24-messages-cron';

beforeEach(() => { resetFetch(); process.env.URL = 'https://test.invalid'; process.env.CRON_SECRET = 'cron-test'; });

test('메시지 background는 비밀키 없이 호출할 수 없다', async () => {
  assert.equal((await background(new Request('https://test.invalid'))).status, 401);
  assert.equal(fetchLog.length, 0);
});

test('예약된 메시지 작업이 background에 인증 헤더를 전달한다', async () => {
  setFetchHandler((_url, init) => { assert.equal(init.headers['x-cron-secret'], 'cron-test'); return json({}, 202); });
  assert.equal((await cron()).status, 200);
  assert.ok(fetchLog[0].url.endsWith('beds24-messages-background'));
});

test('Beds24 수신 오류에도 저장된 자동답변 작업과 담당자 알림 복구를 실행한다', async () => {
  const modes: string[] = [];
  setFetchHandler((url, init) => {
    if (url.pathname === '/api/beds24/messages') return json({ error: 'temporary' }, 500);
    modes.push(JSON.parse(init.body!).mode); return json({ worked: false, queued: 0 });
  });
  const result = await background(new Request('https://test.invalid', { headers: { 'x-cron-secret': 'cron-test' } }));
  assert.equal(result.status, 500);
  assert.deepEqual(modes, ['seed', 'jobs', 'notifications']);
});
