import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, prisma } from './stubs/prisma';
import { enqueueInquiries, processInquiryJob, processInquiryNotification } from '../lib/inquiry-worker';
import { setInquiryPaused, acquireInquirySend, releaseInquirySend } from '../lib/inquiry-conversation';
import type { InquiryDecision } from '../lib/inquiry-ai';

const routine: InquiryDecision = { action: 'reply', category: 'checkin', draft: 'Check-in is at 3 PM.', summary: '체크인 시간 문의', reason: '안내문에 명시된 시간', evidence: ['체크인은 오후 3시입니다.'] };
const sent: string[] = [];
const alerts: string[] = [];
const deps = {
  judge: async () => routine,
  verify: async () => true,
  reservation: async () => true,
  remote: async () => 'unchanged' as const,
  reply: async (_id: string, text: string) => { sent.push(text); return '9001'; },
  kakao: async ({ phone }: { phone: string }) => { alerts.push(phone); return { status: 'accepted' as const, providerMessageId: 'k1' }; },
};

beforeEach(async () => {
  resetDb(); sent.length = 0; alerts.length = 0;
  db.property = [{ id: 'p1', name: '한옥', beds24PropId: '123' }];
  db.event = [{ id: 'e1', propertyId: 'p1', channelId: 'beds24', originalUid: '77', type: 'reservation', startDate: '2026-10-01', endDate: '2026-10-03', numAdults: 2, numChildren: 0 }];
  db.inquiryAutomationSettings = [{ propertyId: 'p1', enabled: true, enabledAt: new Date(Date.now() - 3600_000), knowledge: '체크인은 오후 3시입니다.', updatedAt: new Date(Date.now() - 3600_000) }];
  db.inquiryNotificationSettings = [{ propertyId: 'p1', enabled: true, recipients: [{ name: '담당자', phone: '01012345678' }, { name: '야간', phone: '01098765432' }] }];
  await prisma.message.create({ data: { id: 'm1', eventId: 'e1', propertyId: 'p1', sender: 'guest', source: 'beds24', beds24MessageType: 'guest', beds24BookingId: '77', beds24MessageId: '101', text: 'When is check-in?', createdAt: new Date(Date.now() - 30_000) } });
});

async function runAll(custom = deps) { for (let i = 0; i < 8; i++) if (!await processInquiryJob(custom)) break; }

test('수신→영속 큐→판단→검증→예약/대화 확인→자동 전송, 중복 크론에도 한 번만 보낸다', async () => {
  await enqueueInquiries(); await enqueueInquiries();
  assert.equal(db.inquiryJob.length, 1);
  await runAll(); await runAll();
  assert.deepEqual(sent, [routine.draft]);
  assert.equal(db.inquiryJob[0].status, 'sent');
  const reply = db.message.find(message => message.automated);
  assert.ok(reply);
  assert.equal(reply.beds24MessageId, '9001'); assert.equal(reply.deliveryStatus, 'sent');
});

test('활성화 이전 이력·호스트 메시지·시간 불명 메시지는 큐에 넣지 않는다', async () => {
  db.message[0].createdAt = new Date(0);
  await enqueueInquiries(); assert.equal((db.inquiryJob ?? []).length, 0);
  db.message[0].createdAt = new Date(); db.message[0].sender = 'host';
  await enqueueInquiries(); assert.equal((db.inquiryJob ?? []).length, 0);
});

test('기준 시각 이전 문의는 제외하고 그 이후 새 문의만 처리한다', async () => {
  const cutoff = new Date();
  db.inquiryAutomationSettings[0].enabledAt = cutoff;
  db.message[0].createdAt = cutoff;
  await enqueueInquiries();
  assert.equal((db.inquiryJob ?? []).length, 0);
  db.message.push({ ...db.message[0], id: 'new', beds24MessageId: '102', createdAt: new Date(cutoff.getTime() + 1) });
  await enqueueInquiries();
  assert.deepEqual(db.inquiryJob.map(job => job.messageId), ['new']);
  await runAll();
  assert.deepEqual(sent, [routine.draft]);
});

test('이미 처리 중인 지난 문의도 기준 시각 변경 후 발송하지 않는다', async () => {
  await enqueueInquiries();
  await processInquiryJob(deps);
  assert.equal(db.inquiryJob[0].status, 'verify');
  db.inquiryAutomationSettings[0].enabledAt = new Date();
  await runAll();
  assert.equal(db.inquiryJob[0].status, 'skipped');
  assert.equal(sent.length, 0);
  assert.equal(alerts.length, 0);
});

test('어려운 문의는 답변하지 않고 담당자 응대로 전환, 지정 번호별 알림 1회', async () => {
  await enqueueInquiries();
  await runAll({ ...deps, judge: async () => ({ ...routine, action: 'escalate', reason: '환불 예외 요청' }) });
  assert.equal(sent.length, 0); assert.equal(db.inquiryConversation[0].paused, true);
  assert.equal(db.inquiryJob[0].status, 'escalated');
  await processInquiryNotification(deps); await processInquiryNotification(deps); await processInquiryNotification(deps);
  assert.deepEqual(alerts.sort(), ['01012345678', '01098765432']);
  assert.ok(db.inquiryNotification.every(item => item.status === 'accepted'));
});

test('담당자 응대 중에는 판단이 reply여도 자동 전송 금지; 재개는 이후 새 문의부터', async () => {
  await enqueueInquiries(); await setInquiryPaused('e1', true);
  await runAll(); assert.equal(sent.length, 0); assert.equal(db.inquiryJob[0].status, 'escalated');
  await setInquiryPaused('e1', false);
  db.inquiryJob[0].status = 'queued'; await runAll();
  assert.equal(sent.length, 0); assert.equal(db.inquiryJob[0].status, 'skipped');
});

test('판단 도중 담당자 응대 시작 시 진행 중인 AI 초안은 전송하지 않는다', async () => {
  await enqueueInquiries();
  await processInquiryJob({ ...deps, judge: async () => { await setInquiryPaused('e1', true); return routine; } });
  await runAll(); assert.equal(sent.length, 0);
});

test('외부 플랫폼의 담당자 답변과 새 문의, 변경된 예약은 모두 자동 전송을 막는다', async () => {
  await enqueueInquiries();
  await runAll({ ...deps, remote: async () => 'changed' as never });
  assert.equal(sent.length, 0); assert.equal(db.inquiryJob[0].status, 'escalated');
});

test('변경된 예약 확인 및 독립 검증 실패는 각각 담당자에게 넘긴다', async () => {
  await enqueueInquiries(); await runAll({ ...deps, reservation: async () => false });
  assert.equal(sent.length, 0); assert.match(db.inquiryJob[0].reason, /예약/);
  await setInquiryPaused('e1', false); db.inquiryConversation[0].resumeAfter = null;
  db.inquiryJob[0].status = 'queued';
  await runAll({ ...deps, verify: async () => false });
  assert.equal(sent.length, 0); assert.match(db.inquiryJob[0].reason, /근거/);
});

test('자동답변 발송이 불명확하면 재시도하지 않고 이관한다', async () => {
  await enqueueInquiries(); let attempts = 0;
  await runAll({ ...deps, reply: async () => { attempts++; throw new Error('timeout'); } });
  await runAll(); assert.equal(attempts, 1); assert.equal(sent.length, 0);
  assert.equal(db.inquiryJob[0].status, 'escalated');
  assert.equal(db.message.find(message => message.automated)?.deliveryStatus, 'unknown');
});

test('프로세스 종료 후 남은 전송 의도는 자동 재전송하지 않는다', async () => {
  await enqueueInquiries();
  Object.assign(db.inquiryJob[0], { status: 'sending', updatedAt: new Date(Date.now() - 180_000) });
  await runAll(); assert.equal(sent.length, 0); assert.equal(db.inquiryJob[0].status, 'escalated');
});

test('동시 작업자의 판단 작업 점유는 한 번만 성공한다', async () => {
  await enqueueInquiries(); let judges = 0;
  const custom = { ...deps, judge: async () => { judges++; return routine; } };
  await Promise.all([processInquiryJob(custom), processInquiryJob(custom)]);
  assert.equal(judges, 1);
});

test('자동 발송 잠금 중 수동 발송·재개가 충돌하지 않는다', async () => {
  const token = await acquireInquirySend('e1'); assert.ok(token);
  assert.equal(await acquireInquirySend('e1', true), null);
  await assert.rejects(setInquiryPaused('e1', true), /전송 중/);
  await releaseInquirySend('e1', token!);
  const manual = await acquireInquirySend('e1', true); assert.ok(manual);
  assert.equal(db.inquiryConversation[0].paused, true);
  await releaseInquirySend('e1', manual!);
  assert.equal(await acquireInquirySend('e1'), null);
});

test('최신 안내문 수정 시 생성해 둔 답변을 재판단한다', async () => {
  await enqueueInquiries(); await processInquiryJob(deps);
  db.inquiryAutomationSettings[0].updatedAt = new Date();
  await processInquiryJob(deps); assert.equal(db.inquiryJob[0].status, 'queued'); assert.equal(sent.length, 0);
});

test('알림 발송 전 수신자 삭제를 반영하며 불명확한 접수는 재시도하지 않는다', async () => {
  await enqueueInquiries(); await runAll({ ...deps, judge: async () => ({ ...routine, action: 'escalate' }) });
  db.inquiryNotificationSettings[0].recipients = [{ name: '야간', phone: '01098765432' }];
  let attempts = 0;
  const custom = { ...deps, kakao: async ({ phone }: { phone: string }) => { assert.equal(phone, '01098765432'); attempts++; return { status: 'unknown' as never }; } };
  await processInquiryNotification(custom); await processInquiryNotification(custom); await processInquiryNotification(custom);
  assert.equal(attempts, 1);
});

test('판단 실패는 고객에게 추측 답변 대신 담당자 알림으로 처리한다', async () => {
  await enqueueInquiries(); await runAll({ ...deps, judge: async () => { throw new Error('refused'); } });
  assert.equal(db.inquiryJob[0].status, 'escalated'); assert.equal(sent.length, 0);
});

test('플랫폼에서 가져온 이전 수동 답변 이후의 새 문의는 담당자 응대를 유지한다', async () => {
  await prisma.message.create({ data: { id: 'human', eventId: 'e1', propertyId: 'p1', sender: 'host', source: 'beds24', beds24MessageType: 'host', text: '담당자가 확인하겠습니다.', createdAt: new Date(Date.now() - 60_000) } });
  await enqueueInquiries(); await runAll();
  assert.equal(sent.length, 0); assert.equal(db.inquiryConversation[0].paused, true);
  assert.equal(db.inquiryJob[0].status, 'escalated');
});
