import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb, prisma, prismaOverrides } from './stubs/prisma';
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

async function newInquiry(id = 'm2') {
  await prisma.message.create({ data: { ...db.message[0], id, beds24MessageId: '102', createdAt: new Date(Date.now() + 1000) } });
  await enqueueInquiries();
}

test('사업자 메시지 옵션을 끄면 새 자동응답과 이미 생성한 답변 모두 전송하지 않는다', async () => {
  db.property[0].organization = { status: 'active', features: { messages: false } };
  db.property[0].featureOverrides = { messages: true };
  await enqueueInquiries();
  assert.equal((db.inquiryJob ?? []).length, 0);
  db.property[0].organization.features.messages = true;
  await enqueueInquiries();
  await processInquiryJob(deps);
  db.property[0].organization.features.messages = false;
  await runAll();
  assert.equal(db.inquiryJob[0].status, 'skipped');
  assert.equal(sent.length, 0);
});

test('담당자 응대 중에도 단순 감사에는 AI 호출·자동답변·카카오 알림을 만들지 않는다', async () => {
  db.message[0].text = 'Thank you! 😊';
  await setInquiryPaused('e1', true);
  await enqueueInquiries();
  await runAll({ ...deps, judge: async () => { throw new Error('감사 인사에는 AI 호출 불필요'); } });
  assert.equal(db.inquiryJob[0].status, 'skipped');
  assert.equal(db.inquiryConversation[0].paused, true);
  assert.equal(sent.length, 0);
  assert.equal((db.inquiryNotification ?? []).length, 0);
});

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

test('등록된 택시 안내는 검증 후 한 번 전송하며 담당자 알림으로 넘기지 않는다', async () => {
  const knowledge = '인천공항 밴택시 기준 요금은 100,000원입니다. 공항 픽업 서비스는 사전 예약이 필요합니다.';
  db.inquiryAutomationSettings[0].knowledge = knowledge;
  db.message[0].text = 'Should we pre-book a taxi? How much is the airport pickup?';
  const decision: InquiryDecision = { ...routine, category: 'transport',
    draft: 'Our Incheon Airport van transfer costs KRW 100,000 and requires advance booking.', evidence: [knowledge] };
  await enqueueInquiries();
  const custom = { ...deps, judge: async () => decision };
  await runAll(custom); await runAll(custom); await processInquiryNotification(custom);
  assert.deepEqual(sent, [decision.draft]);
  assert.equal(db.inquiryJob[0].status, 'sent');
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.equal(alerts.length, 0);
});

test('차량 예약 요청은 자동 발송 없이 담당자에게 넘긴다', async () => {
  db.message[0].text = 'How much is the taxi? Please book one for us.';
  await enqueueInquiries();
  await runAll({ ...deps, judge: async () => ({ ...routine, category: 'transport', action: 'escalate', reason: '실제 차량 예약 요청은 담당자 확인이 필요합니다.' }) });
  assert.equal(sent.length, 0);
  assert.equal(db.inquiryJob[0].status, 'escalated');
  await processInquiryNotification(deps);
  assert.equal(alerts.length, 1);
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

test('초안 작성 뒤 원격 대화가 변경되면 고객에게 보내지 않고 담당자에게 넘긴다', async () => {
  await enqueueInquiries();
  await runAll({ ...deps, remote: async () => 'changed' as never });
  assert.equal(sent.length, 0); assert.equal(db.inquiryJob[0].status, 'escalated');
  assert.match(db.inquiryJob[0].reason, /대화가 변경/);
  assert.equal(db.inquiryConversation[0].paused, true);
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
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.ok(db.inquiryConversation[0].resumeAfter instanceof Date);
  assert.equal(await acquireInquirySend('e1'), null);
  await releaseInquirySend('e1', manual!);
  const next = await acquireInquirySend('e1'); assert.ok(next);
  await releaseInquirySend('e1', next!);
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

test('출처가 확인되지 않은 과거 host 메시지만으로 새 문의의 자동답변을 중지하지 않는다', async () => {
  await prisma.message.create({ data: { id: 'imported-host', eventId: 'e1', propertyId: 'p1', sender: 'host', source: 'beds24', beds24MessageType: 'host', beds24BookingId: '77', beds24MessageId: '100', automated: false, text: '담당자가 확인하겠습니다.', createdAt: new Date(Date.now() - 60_000) } });
  await enqueueInquiries(); await runAll();
  assert.deepEqual(sent, [routine.draft]);
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.equal(db.inquiryJob[0].status, 'sent');
  const importedHost = db.message.find(message => message.id === 'imported-host');
  assert.ok(importedHost);
  assert.equal(importedHost.automated, false);
});

test('Beds24 자동 안내 뒤 새 주차 문의는 근거와 예약·대화를 검증하고 한 번 답변한다', async () => {
  const knowledge = '숙소 인근 공영주차장을 이용할 수 있습니다. 실제 요금과 운영 시간은 주차장에 확인해 주세요.';
  const decision: InquiryDecision = { action: 'reply', category: 'parking', draft: '숙소 인근 공영주차장을 이용할 수 있습니다. 요금과 운영 시간은 해당 주차장에 확인해 주세요.', summary: '주변 주차 방법 문의', reason: '저장된 주차 안내', evidence: [knowledge] };
  db.inquiryAutomationSettings[0].knowledge = knowledge;
  db.message[0].text = '안녕하세요. 잘 체크인했습니다. 가까운 곳에 주차하려면 어떻게 하나요?';
  await prisma.message.create({ data: { id: 'arrival-guide', eventId: 'e1', propertyId: 'p1', sender: 'host', source: 'beds24', beds24MessageType: 'host', beds24BookingId: '77', beds24MessageId: '100', automated: false, text: '예약 안내입니다. PLAN YOUR STAY: https://example.invalid/guide', createdAt: new Date(Date.now() - 60_000) } });
  const checks: string[] = [];
  const custom = { ...deps,
    judge: async () => { checks.push('judge'); return decision; },
    verify: async () => { checks.push('verify'); return true; },
    reservation: async () => { checks.push('reservation'); return true; },
    remote: async () => { checks.push('remote'); return 'unchanged' as const; },
  };
  await enqueueInquiries(); await runAll(custom); await runAll(custom);
  assert.deepEqual(checks, ['judge', 'verify', 'reservation', 'remote']);
  assert.deepEqual(sent, [decision.draft]);
  assert.equal(db.inquiryJob[0].status, 'sent');
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.equal((db.inquiryNotification ?? []).length, 0);
  const arrivalGuide = db.message.find(message => message.id === 'arrival-guide');
  assert.ok(arrivalGuide);
  assert.equal(arrivalGuide.automated, false);
});

for (const preparedSteps of [0, 1, 4]) {
  test(`문의 이후 수집된 host 답변이 있으면 처리 ${preparedSteps}단계 뒤에도 추가 답변하지 않는다`, async () => {
    await enqueueInquiries();
    for (let step = 0; step < preparedSteps; step++) await processInquiryJob(deps);
    await prisma.message.create({ data: { id: 'new-host', eventId: 'e1', propertyId: 'p1', sender: 'host', source: 'beds24', beds24MessageType: 'host', beds24BookingId: '77', beds24MessageId: '102', automated: false, text: '주차장 위치를 안내드렸습니다.', createdAt: new Date() } });
    await runAll();
    assert.equal(sent.length, 0);
    assert.equal(db.inquiryJob[0].status, 'skipped');
    assert.equal((db.inquiryNotification ?? []).length, 0);
  });
}

for (const preparedSteps of [1, 2, 3, 4]) {
  test(`AI 처리 ${preparedSteps}단계 뒤 직접 응대하면 이전 문의만 막고 새 문의는 판단한다`, async () => {
    await enqueueInquiries();
    for (let step = 0; step < preparedSteps; step++) await processInquiryJob(deps);
    const token = await acquireInquirySend('e1', true);
    assert.ok(token);
    await releaseInquirySend('e1', token);
    await runAll();
    assert.equal(sent.length, 0);
    assert.equal(db.inquiryConversation[0].paused, false);
    assert.equal(db.inquiryJob[0].status, 'skipped');
    await newInquiry(); await runAll();
    assert.deepEqual(sent, [routine.draft]);
    assert.equal(db.inquiryJob.find(job => job.messageId === 'm1')?.status, 'skipped');
    assert.equal(db.inquiryJob.find(job => job.messageId === 'm2')?.status, 'sent');
  });
}

test('기존 중지 상태는 과거 host 메시지 유무와 관계없이 자동 해제하지 않는다', async () => {
  await prisma.inquiryConversation.create({ data: { eventId: 'e1', paused: true, pauseSource: null, pauseMessageId: null, reason: '담당자의 기존 답변이 확인되어 자동답변을 중지했습니다.' } });
  await enqueueInquiries(); await runAll();
  const token = await acquireInquirySend('e1', true); assert.ok(token);
  await releaseInquirySend('e1', token);
  await newInquiry(); await runAll();
  assert.equal(sent.length, 0);
  assert.equal(db.inquiryConversation[0].paused, true);
  assert.equal(db.inquiryConversation[0].pauseSource, null);
  assert.equal(db.inquiryConversation[0].pauseMessageId, null);
  assert.match(db.inquiryConversation[0].reason, /기존 답변/);
  assert.equal(db.inquiryJob[0].status, 'escalated');
});

test('자동 이관은 해당 문의만 중지하고 다음 문의를 새로 판단하며 과거 작업은 재발송하지 않는다', async () => {
  await enqueueInquiries();
  await runAll({ ...deps, judge: async () => ({ ...routine, action: 'escalate', reason: '담당자 확인 필요' }) });
  assert.equal(db.inquiryConversation[0].pauseSource, 'automatic');
  assert.equal(db.inquiryConversation[0].pauseMessageId, 'm1');
  await newInquiry(); await runAll(); await enqueueInquiries(); await runAll();
  assert.deepEqual(sent, [routine.draft]);
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.equal(db.inquiryConversation[0].pauseSource, null);
  assert.equal(db.inquiryConversation[0].pauseMessageId, null);
  assert.equal(db.inquiryJob.find(job => job.messageId === 'm1')?.status, 'escalated');
  assert.equal(db.inquiryJob.find(job => job.messageId === 'm2')?.status, 'sent');
  assert.equal(db.inquiryNotification.length, 2);
});

test('명시적 자동응답 중지는 직접 답변과 새 문의 뒤에도 유지하고 명시적 재개만 해제한다', async () => {
  await setInquiryPaused('e1', true, '운영자가 중지');
  const token = await acquireInquirySend('e1', true); assert.ok(token);
  await releaseInquirySend('e1', token);
  await newInquiry(); await runAll();
  assert.equal(sent.length, 0);
  assert.equal(db.inquiryConversation[0].pauseSource, 'manual');
  assert.equal(db.inquiryConversation[0].reason, '운영자가 중지');
  await setInquiryPaused('e1', false);
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.equal(db.inquiryConversation[0].pauseSource, null);
  assert.equal(db.inquiryConversation[0].pauseMessageId, null);
  assert.ok(db.inquiryConversation[0].resumeAfter instanceof Date);
});

test('직접 응대 중 끝난 이전 AI 이관 결과는 대화를 다시 중지시키지 않는다', async () => {
  await enqueueInquiries();
  await processInquiryJob({ ...deps, judge: async () => {
    const token = await acquireInquirySend('e1', true); assert.ok(token);
    await releaseInquirySend('e1', token);
    return { ...routine, action: 'escalate', reason: '이전 문의 판단' };
  } });
  assert.equal(db.inquiryConversation[0].paused, false);
  assert.equal(db.inquiryJob[0].status, 'escalated');
  await newInquiry(); await runAll();
  assert.deepEqual(sent, [routine.draft]);
});

test('새 문의가 자동 중지를 해제하는 순간의 명시적 중지 변경을 덮어쓰지 않는다', async () => {
  await enqueueInquiries(); await runAll({ ...deps, judge: async () => ({ ...routine, action: 'escalate' }) });
  await newInquiry();
  const base = prisma.inquiryConversation;
  let raced = false;
  prismaOverrides.inquiryConversation = { ...base, updateMany: async (args: any) => {
    if (!raced && args.where.pauseSource === 'automatic' && args.data.paused === false) {
      raced = true;
      await setInquiryPaused('e1', true, '운영자가 유지한 중지');
    }
    return base.updateMany(args);
  } };
  await runAll();
  assert.equal(raced, true);
  assert.equal(sent.length, 0);
  assert.equal(db.inquiryConversation[0].paused, true);
  assert.equal(db.inquiryConversation[0].pauseSource, 'manual');
  assert.equal(db.inquiryConversation[0].reason, '운영자가 유지한 중지');
});

test('전송 결과가 불명확한 과거 답변은 새 문의 재개 후에도 다시 보내지 않는다', async () => {
  await enqueueInquiries();
  let attempts = 0;
  await runAll({ ...deps, reply: async () => { attempts++; throw new Error('timeout'); } });
  await newInquiry(); await runAll(); await runAll();
  assert.equal(attempts, 1);
  assert.deepEqual(sent, [routine.draft]);
  assert.equal(db.inquiryJob.find(job => job.messageId === 'm1')?.status, 'escalated');
  assert.equal(db.message.find(message => message.deliveryStatus === 'unknown')?.automated, true);
});

test('자동 중지 해제와 직접 답변이 경합하면 최신 수동 응대 기준을 다시 읽어 해당 문의를 제외한다', async () => {
  await enqueueInquiries(); await runAll({ ...deps, judge: async () => ({ ...routine, action: 'escalate' }) });
  await newInquiry();
  db.message.find(message => message.id === 'm2')!.createdAt = new Date(Date.now() - 1);
  const base = prisma.inquiryConversation;
  let raced = false;
  prismaOverrides.inquiryConversation = { ...base, updateMany: async (args: any) => {
    if (!raced && args.where.pauseSource === 'automatic' && args.data.paused === false) {
      raced = true;
      const token = await acquireInquirySend('e1', true); assert.ok(token);
      await releaseInquirySend('e1', token);
    }
    return base.updateMany(args);
  } };
  await runAll();
  assert.equal(raced, true);
  assert.equal(sent.length, 0);
  assert.equal(db.inquiryJob.find(job => job.messageId === 'm2')?.status, 'skipped');
  await newInquiry('m3'); await runAll();
  assert.deepEqual(sent, [routine.draft]);
});

test('고객 확인 알림은 예약의 답장 플랫폼을 포함한다', async () => {
  db.event[0].source = 'booking';
  await enqueueInquiries(); await runAll({ ...deps, judge: async () => ({ ...routine, action: 'escalate' }) });
  let reason = '';
  await processInquiryNotification({ ...deps, kakao: async (input) => { reason = input.reason; return { status: 'accepted' as const }; } });
  assert.match(reason, /답장: Booking.com 예약 메시지/);
});
