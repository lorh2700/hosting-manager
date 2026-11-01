import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNotifier, notifyCleaningAssigned, notifyInterimCleaningOpen, type SmsMessage } from '../lib/notify';

test('interim assignment and recruitment send only accurate SMS with no checkout template', async context => {
  const notifier = getNotifier();
  const messages: SmsMessage[] = [];
  const sms = context.mock.method(notifier, 'sendSms', async (message: SmsMessage) => { messages.push(message); return { ok: true, provider: 'test' }; });
  const kakao = context.mock.method(notifier, 'sendAlimtalk', async () => ({ ok: true, provider: 'test' }));
  for (const role of ['primary', 'assistant'] as const) {
    await notifyCleaningAssigned({ cleaningKind: 'interim', role, cleanerPhone: '010-test', cleanerName: '직원', cleanerToken: null, items: [{ propertyName: '숙소', date: '2026-11-03' }] });
  }
  await notifyInterimCleaningOpen({ cleanerPhone: '010-test', cleanerName: '직원', propertyName: '숙소', date: '2026-11-03' });
  assert.equal(sms.mock.callCount(), 3); assert.equal(kakao.mock.callCount(), 0);
  for (const message of messages) { assert.match(message.text, /중간청소/); assert.doesNotMatch(message.text, /11:00|체크아웃/); }
  assert.match(messages[2].text, /https:\/\/admin\.voidanchae\.com\/cleanings/);
});
