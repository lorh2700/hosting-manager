import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guestStayNotificationText, notifyGuestStayRequest } from '../lib/guest-stay-notifications';
import type { GuestStayRequestDTO } from '../lib/guest-stay';
import type { NotifyProvider, SmsMessage } from '../lib/notify';

const stay = { propertyId: 'p1', guestName: 'Test Guest', checkIn: '2026-12-01', checkOut: '2026-12-05', property: { name: '별하재' } };
const request: GuestStayRequestDTO = { id: 'r1', kind: 'taxi', status: 'requested', source: 'pad',
  details: { date: '2026-12-02', time: '12:00', destination: '인천공항', passengers: 3, luggage: 2, note: '항공편 KE001' },
  publicReply: '', createdAt: '', updatedAt: '', version: 1 };
const recipients = [{ userId: 'u1', name: '담당자', phone: '01012345678' }];
function provider(sendSms: NotifyProvider['sendSms']): NotifyProvider {
  return { name: 'test', sendSms, sendAlimtalk: async () => { throw new Error('unexpected alimtalk'); } };
}

test('new pad pickup alert uses resolved staff recipients and awaits provider acceptance', async context => {
  const logs: unknown[] = [];
  context.mock.method(console, 'info', (...args: unknown[]) => logs.push(args));
  const sent: SmsMessage[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let finished = false;
  const work = notifyGuestStayRequest(stay, request, {
    recipients: async propertyId => { assert.equal(propertyId, 'p1'); return recipients; },
    notifier: () => provider(async message => {
      sent.push(message); await pending; return { ok: true, provider: 'test', messageId: 'sms-1' };
    }),
  }).then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, recipients[0].phone);
  assert.ok(sent[0].signal instanceof AbortSignal);
  assert.match(sent[0].text, /객실 패드/);
  assert.match(sent[0].text, /별하재 · 택시·픽업 신청/);
  assert.match(sent[0].text, /인천공항/);
  assert.match(sent[0].text, /항공편 KE001/);
  release(); await work;
  assert.match(JSON.stringify(logs), /accepted/);
  assert.match(JSON.stringify(logs), /sms-1/);
  assert.doesNotMatch(JSON.stringify(logs), /01012345678|Test Guest|KE001/);
});

test('missing recipients and unconfigured notifier do not send or expose guest data', async context => {
  const logs: unknown[] = [];
  context.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  let called = 0;
  const noop: NotifyProvider = { ...provider(async () => { called++; throw new Error('must not call noop'); }), name: 'noop' };
  await notifyGuestStayRequest(stay, request, { recipients: async () => [], notifier: () => { called++; return noop; } });
  await notifyGuestStayRequest(stay, request, { recipients: async () => recipients, notifier: () => noop });
  assert.equal(called, 0);
  assert.match(JSON.stringify(logs), /no_recipients/);
  assert.match(JSON.stringify(logs), /provider_unconfigured/);
  assert.doesNotMatch(JSON.stringify(logs), /01012345678|Test Guest|인천공항/);
});

test('recipient lookup and each delivery failure are contained without retrying', async context => {
  const logs: unknown[] = [];
  context.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  context.mock.method(console, 'info', (...args: unknown[]) => logs.push(args));
  let calls = 0;
  const many = [0, 1, 2, 3, 4].map(index => ({ ...recipients[0], userId: `u${index}`, phone: `0100000000${index}` }));
  await notifyGuestStayRequest(stay, request, { recipients: async () => many, notifier: () => provider(async () => {
    const index = calls++;
    if (index === 0) throw new Error('private provider error with phone');
    if (index === 1) return { ok: false, provider: 'test', deliveryUnknown: true };
    if (index === 2) return { ok: false, provider: 'test', error: 'private rejection' };
    if (index === 3) return { ok: true, provider: 'test' };
    return { ok: true, provider: 'test', messageId: 'accepted-5' };
  }) });
  await notifyGuestStayRequest(stay, request, { recipients: async () => { throw new Error('private database error'); }, notifier: () => { throw new Error('unexpected'); } });
  assert.equal(calls, 5);
  const output = JSON.stringify(logs);
  assert.match(output, /notification_failed/);
  assert.match(output, /delivery_unknown/);
  assert.match(output, /"status":"failed"/);
  assert.match(output, /accepted-5/);
  assert.doesNotMatch(output, /private|0100000000/);
});

test('all service kinds have useful, bounded alert summaries', () => {
  const help = guestStayNotificationText(stay, { ...request, kind: 'help', source: 'mobile', details: { category: 'supplies', message: '수건'.repeat(1000) } });
  assert.match(help, /게스트 앱/); assert.match(help, /객실 요청/); assert.match(help, /분류: 비품/);
  const tour = guestStayNotificationText(stay, { ...request, kind: 'tour', tourTitle: '북촌 산책', durationTitle: '2시간', details: { tourId: 'tour-1', date: '2026-12-02', time: '14:00', guests: 2, note: '' } });
  assert.match(tour, /북촌 산책/); assert.match(tour, /2시간/); assert.match(tour, /인원: 2명/);
  const cleaning = guestStayNotificationText(stay, { ...request, kind: 'interim_cleaning', details: { date: '2026-12-02', time: '12:00', note: '중간청소 요청' } });
  assert.match(cleaning, /중간청소 신청/); assert.match(cleaning, /2026-12-02 12:00/);
  for (const text of [help, tour, cleaning]) {
    assert.ok(Buffer.byteLength(text, 'utf8') <= 1800);
    assert.match(text, /접수번호: r1$/);
  }
});

test('only tour requests use the tour recipient resolver; room requests keep property recipients', async () => {
  const sent: SmsMessage[] = [];
  const deps = { recipients: async () => recipients,
    tourRecipients: async (propertyId: string) => { assert.equal(propertyId, 'p1'); return [{ name: '투어 담당자', phone: '01033334444' }]; },
    notifier: () => provider(async message => { sent.push(message); return { ok: true, provider: 'test', messageId: 'm1' }; }) };
  const tour: GuestStayRequestDTO = { ...request, kind: 'tour', details: { tourId: 'foreign-tour', date: '2026-12-02', time: '14:00', guests: 2, note: '' } };
  await notifyGuestStayRequest(stay, tour, deps);
  await notifyGuestStayRequest(stay, request, deps);
  assert.deepEqual(sent.map(message => message.to), ['01033334444', recipients[0].phone]);
});

test('SMS provider passes the caller timeout signal to its only network request', async context => {
  const keys = ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PFID', 'SOLAPI_FROM'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'fixture';
  context.after(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  const { getNotifier } = await import('../lib/notify');
  const signal = AbortSignal.timeout(1000);
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++; assert.equal(options.signal, signal);
    return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 });
  });
  const result = await getNotifier().sendSms({ to: '01000000000', text: 'fixture', signal });
  assert.equal(result.messageId, 'm1'); assert.equal(calls, 1);
});
