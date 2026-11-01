import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let notify: typeof import('../lib/notify');
before(async () => {
  for (const key of ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PFID', 'SOLAPI_FROM']) process.env[key] = 'fixture';
  delete process.env.SOLAPI_TPL_TOUR_BOOKING_HOST;
  delete process.env.SOLAPI_TPL_TOUR_BOOKING_NEW;
  notify = await import('../lib/notify');
});
const input = { hostPhone: '01033334444', hostName: '담당자', tourTitle: '북촌 산책', guestName: 'Guest', guestPhone: '01012345678',
  guests: 2, date: '2028-10-12', startTime: '14:30', meetingPoint: null, bookingId: 'inquiry-1', inquiry: true };

test('missing host template sends one bounded operator SMS, never to the applicant', async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++;
    assert.ok(options.signal instanceof AbortSignal);
    const message = JSON.parse(String(options.body)).message;
    assert.equal(message.to, input.hostPhone);
    assert.match(message.text, /투어 문의 접수/);
    assert.match(message.text, /01012345678/);
    assert.match(message.text, /inquiry-1/);
    return new Response(JSON.stringify({ messageId: 'sent-1' }), { status: 200 });
  });
  assert.equal((await notify.notifyTourHostOfBooking(input))?.messageId, 'sent-1');
  assert.equal(calls, 1);
});

test('ambiguous host delivery is never retried and missing host never redirects to the guest', async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('timeout'); });
  assert.equal((await notify.notifyTourHostOfBooking(input))?.deliveryUnknown, true);
  assert.equal(await notify.notifyTourHostOfBooking({ ...input, hostPhone: null }), null);
  assert.equal(calls, 1);
});

test('alimtalk provider carries the bounded signal to its single request', async context => {
  const signal = AbortSignal.timeout(8000);
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++; assert.equal(options.signal, signal);
    return new Response(JSON.stringify({ messageId: 'kakao-1' }), { status: 200 });
  });
  const result = await notify.getNotifier().sendAlimtalk({ to: input.hostPhone, templateId: 'fixture', variables: {}, signal });
  assert.equal(result.messageId, 'kakao-1'); assert.equal(calls, 1);
});
