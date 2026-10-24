import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SmsMessage } from '../lib/notify';

process.env.SOLAPI_API_KEY = 'checkout-test-key';
process.env.SOLAPI_API_SECRET = 'checkout-test-secret';
process.env.SOLAPI_PFID = 'checkout-test-profile';
process.env.SOLAPI_FROM = '01000000000';
process.env.SOLAPI_TPL_CHECKOUT_CONFIRMED = 'checkout-test-template';

const { getNotifier, notifyCheckoutConfirmed } = await import('../lib/notify');

const opts = { phone: '01012345678', name: '담당자', propertyName: '안온재', timeText: '10:30', by: 'guest' as const };

test('체크아웃 알림톡 발송 성공 시 별도 문자를 보내지 않는다', async context => {
  const notifier = getNotifier();
  const alimtalk = context.mock.method(notifier, 'sendAlimtalk', async () => ({ ok: true, provider: 'test', messageId: 'accepted' }));
  const sms = context.mock.method(notifier, 'sendSms', async () => ({ ok: true, provider: 'test' }));

  assert.equal((await notifyCheckoutConfirmed(opts))?.ok, true);
  assert.equal(alimtalk.mock.callCount(), 1);
  assert.equal(sms.mock.callCount(), 0);
});

test('체크아웃 알림톡의 전달 결과가 불확실하면 문자를 추가 발송하지 않는다', async context => {
  const notifier = getNotifier();
  context.mock.method(notifier, 'sendAlimtalk', async () => ({ ok: false, provider: 'test', deliveryUnknown: true, error: 'response lost' }));
  const sms = context.mock.method(notifier, 'sendSms', async () => ({ ok: true, provider: 'test' }));

  const result = await notifyCheckoutConfirmed(opts);
  assert.equal(result?.ok, false);
  assert.equal(result?.deliveryUnknown, true);
  assert.equal(sms.mock.callCount(), 0);
});

test('체크아웃 알림톡 호출이 예외로 끝나도 발송 여부 확인 없이 문자를 보내지 않는다', async context => {
  const notifier = getNotifier();
  context.mock.method(notifier, 'sendAlimtalk', async () => { throw new Error('transport interrupted'); });
  const sms = context.mock.method(notifier, 'sendSms', async () => ({ ok: true, provider: 'test' }));

  const result = await notifyCheckoutConfirmed(opts);
  assert.equal(result?.ok, false);
  assert.equal(result?.deliveryUnknown, true);
  assert.equal(sms.mock.callCount(), 0);
});

test('체크아웃 알림톡이 명시적으로 거부되면 한 번만 문자로 대체한다', async context => {
  const notifier = getNotifier();
  context.mock.method(notifier, 'sendAlimtalk', async () => ({ ok: false, provider: 'test', error: 'template rejected' }));
  const sms = context.mock.method(notifier, 'sendSms', async (message: SmsMessage) => {
    assert.equal(message.to, opts.phone);
    return { ok: true, provider: 'test', messageId: 'sms-accepted' };
  });

  const result = await notifyCheckoutConfirmed(opts);
  assert.equal(result?.messageId, 'sms-accepted');
  assert.equal(sms.mock.callCount(), 1);
  assert.equal(sms.mock.calls[0].arguments[0].to, opts.phone);
});
