import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { judgeInquiry, verifyInquiry, type InquiryContext } from '@/lib/inquiry-ai';
import { checkInquiryRemote, checkInquiryReservation, sendInquiryReply, sendInquiryKakao } from '@/lib/inquiry-delivery';
import { getInquiryNotificationRecipients } from '@/lib/inquiry-notification-recipients';
import { acquireInquirySend, releaseInquirySend, ensureInquiryConversation } from '@/lib/inquiry-conversation';
import type { InquiryJob } from '@/generated/prisma/client';

const defaults = { judge: judgeInquiry, verify: verifyInquiry, reservation: checkInquiryReservation, remote: checkInquiryRemote, reply: sendInquiryReply, kakao: sendInquiryKakao };
type Dependencies = typeof defaults;
const leaseMs = 120_000;

/** Durable reconciliation covers crashes between message ingestion and queue insertion. */
export async function enqueueInquiries(): Promise<number> {
  const settings = await prisma.inquiryAutomationSettings.findMany({ where: { enabled: true } });
  let count = 0;
  for (const config of settings) {
    if (!config.enabledAt) continue;
    const after = new Date(Math.max(config.enabledAt.getTime(), Date.now() - 3 * 86400_000));
    const messages = await prisma.message.findMany({
      where: { propertyId: config.propertyId, sender: 'guest', source: 'beds24', beds24MessageType: 'guest', beds24MessageId: { not: null },
        createdAt: { gt: after }, eventId: { not: null }, inquiryJob: { is: null } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    if (messages.length) {
      const result = await prisma.inquiryJob.createMany({ data: messages.map(message => ({ messageId: message.id, eventId: message.eventId!, propertyId: config.propertyId })), skipDuplicates: true });
      count += result.count;
    }
  }
  const missedAlerts = await prisma.inquiryJob.findMany({ where: { status: 'escalated', notifications: { none: {} }, createdAt: { gt: new Date(Date.now() - 3 * 86400_000) } }, take: 100, orderBy: { createdAt: 'desc' } });
  for (const job of missedAlerts) await queueAlerts(job);
  return count;
}

async function contextFor(job: InquiryJob) {
  const [config, event, conversation, message, history] = await Promise.all([
    prisma.inquiryAutomationSettings.findUnique({ where: { propertyId: job.propertyId } }),
    prisma.event.findUnique({ where: { id: job.eventId }, include: { property: { select: { name: true, beds24PropId: true } } } }),
    ensureInquiryConversation(job.eventId),
    prisma.message.findUnique({ where: { id: job.messageId } }),
    prisma.message.findMany({ where: { eventId: job.eventId, type: 'message' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30 }),
  ]);
  if (!config?.enabled || !config.enabledAt || !config.knowledge.trim() || !event || event.type !== 'reservation'
    || event.channelId !== 'beds24' || !/^\d+$/.test(event.originalUid || '') || !event.property.beds24PropId
    || event.propertyId !== job.propertyId || !message || message.eventId !== job.eventId || message.propertyId !== job.propertyId
    || message.sender !== 'guest' || message.beds24MessageType !== 'guest' || !message.beds24MessageId
    || message.beds24BookingId !== event.originalUid
    || message.createdAt <= config.enabledAt || Date.now() - message.createdAt.getTime() > 3 * 86400_000
    || (conversation.resumeAfter && message.createdAt <= conversation.resumeAfter)) return null;
  const conversationHistory = history.filter(item => !item.beds24MessageType || ['guest', 'host'].includes(item.beds24MessageType));
  const latest = conversationHistory.find(item => item.sender === 'guest' || item.sender === 'host');
  if (latest?.id !== message.id) return null;
  const context: InquiryContext = {
    knowledge: config.knowledge,
    reservation: { property: event.property.name, checkIn: event.startDate, checkOut: event.endDate, adults: event.numAdults, children: event.numChildren },
    messages: conversationHistory.slice().reverse().map(item => ({ sender: item.sender, text: item.text.slice(0, 4000) })),
  };
  const manualAfter = conversation.resumeAfter && conversation.resumeAfter > config.enabledAt ? conversation.resumeAfter : config.enabledAt;
  const manualReply = !conversation.paused && await prisma.message.findFirst({ where: {
    eventId: job.eventId, sender: 'host', automated: false, type: 'message', createdAt: { gt: manualAfter },
    OR: [{ beds24MessageType: null }, { beds24MessageType: 'host' }],
  }, select: { id: true } });
  if (manualReply) {
    await prisma.inquiryConversation.update({ where: { eventId: job.eventId }, data: { paused: true, reason: '담당자의 기존 답변이 확인되어 자동답변을 중지했습니다.' } });
    conversation.paused = true;
  }
  return { config, event, conversation, message, context };
}

async function queueAlerts(job: InquiryJob) {
  const recipients = await getInquiryNotificationRecipients(job.propertyId);
  if (!recipients.length) return;
  await prisma.inquiryNotification.createMany({ data: recipients.map(recipient => ({ jobId: job.messageId, ...recipient })), skipDuplicates: true });
}

async function escalate(job: InquiryJob, reason: string, summary = job.summary, draft = job.draft) {
  await ensureInquiryConversation(job.eventId);
  const changed = await prisma.$transaction(async tx => {
    const result = await tx.inquiryJob.updateMany({ where: { messageId: job.messageId, leaseToken: job.leaseToken, status: { notIn: ['sent', 'skipped', 'escalated'] } },
      data: { status: 'escalated', reason, summary, draft, leaseToken: null, leaseUntil: null } });
    if (!result.count) return false;
    await tx.inquiryConversation.update({ where: { eventId: job.eventId }, data: { paused: true, reason } });
    return true;
  });
  if (!changed) return;
  // Reconciled independently below if this insert fails or the function is terminated.
  await queueAlerts(job);
}

async function skip(job: InquiryJob, reason: string) {
  await prisma.inquiryJob.updateMany({ where: { messageId: job.messageId, leaseToken: job.leaseToken }, data: { status: 'skipped', reason, leaseToken: null, leaseUntil: null } });
}

async function advance(job: InquiryJob, status: string, data: { draft?: string; summary?: string; reason?: string; evidence?: string[]; knowledgeVersion?: Date } = {}) {
  await prisma.inquiryJob.updateMany({ where: { messageId: job.messageId, leaseToken: job.leaseToken }, data: { status, ...data, leaseToken: null, leaseUntil: null } });
}

/** One external operation per phase keeps the HTTP worker bounded. */
export async function processInquiryJob(deps: Dependencies = defaults): Promise<boolean> {
  const now = new Date();
  // A crash after persisting send intent is ambiguous: never automatically resend.
  const interrupted = await prisma.inquiryJob.findFirst({ where: { status: 'sending', updatedAt: { lt: new Date(Date.now() - leaseMs) } } });
  if (interrupted) {
    await escalate(interrupted, '자동답변 전송 결과 확인이 필요합니다. Beds24 발송 내역을 확인해 주세요.');
    return true;
  }
  const pending = await prisma.inquiryJob.findFirst({
    where: { status: { in: ['queued', 'verify', 'booking', 'ready', 'checked'] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) return false;
  const token = randomUUID();
  const claimed = await prisma.inquiryJob.updateMany({
    where: { messageId: pending.messageId, status: pending.status, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs) },
  });
  if (!claimed.count) return true;
  const job = { ...pending, leaseToken: token };
  try {
    const current = await contextFor(job);
    if (!current) { await skip(job, '이미 답변했거나 더 최근 문의가 있거나 자동답변 대상이 아닙니다.'); return true; }
    if (current.message.text.length > 4000) { await escalate(job, '긴 문의는 담당자가 전체 내용을 확인해야 합니다.'); return true; }
    if (current.conversation.paused) {
      const decision = await deps.judge(current.context);
      await escalate(job, '담당자 응대 중 새 문의가 도착했습니다.', decision.summary, decision.draft);
      return true;
    }
    if (job.status !== 'queued' && (!job.knowledgeVersion || current.config.updatedAt.getTime() !== job.knowledgeVersion.getTime())) {
      await advance(job, 'queued'); return true;
    }
    if (job.status === 'queued') {
      const decision = await deps.judge(current.context);
      if (decision.action === 'escalate') await escalate(job, decision.reason || '담당자 확인이 필요합니다.', decision.summary, decision.draft);
      else await advance(job, 'verify', { draft: decision.draft, summary: decision.summary, reason: decision.reason, evidence: decision.evidence, knowledgeVersion: current.config.updatedAt });
    } else if (job.status === 'verify') {
      if (await deps.verify(current.context, job.draft)) await advance(job, 'booking');
      else await escalate(job, '답변의 근거 또는 요청 처리 범위를 담당자가 확인해야 합니다.');
    } else if (job.status === 'booking') {
      if (await deps.reservation(current.event.originalUid!, current.event.property.beds24PropId!, current.context.reservation)) await advance(job, 'ready');
      else await escalate(job, '예약 정보가 변경되었거나 확인되지 않습니다. 최신 예약을 확인해 주세요.');
    } else if (job.status === 'ready') {
      if (await deps.remote(current.event.originalUid!, current.message.beds24MessageId!) === 'unchanged') await advance(job, 'checked');
      else await escalate(job, '플랫폼의 대화가 변경되었습니다. 최신 대화를 확인해 주세요.');
    } else {
      // Recheck the remote conversation again if queueing delayed the checked phase.
      if (Date.now() - pending.updatedAt.getTime() > 15_000) { await advance(job, 'ready'); return true; }
      const sendToken = await acquireInquirySend(job.eventId);
      if (!sendToken) { await advance(job, 'ready'); return true; }
      try {
        // Check settings and latest local message AFTER acquiring the shared send lease.
        const fresh = await contextFor(job);
        if (!fresh || fresh.conversation.paused || fresh.config.updatedAt.getTime() !== job.knowledgeVersion?.getTime()) {
          await skip(job, '전송 전에 대화 또는 설정이 변경되었습니다.'); return true;
        }
        if (!(await getInquiryNotificationRecipients(job.propertyId)).length) {
          await escalate(job, '알림 수신자가 없어 자동답변을 중지했습니다. 수신 설정을 확인해 주세요.'); return true;
        }
        // Reserve a local outbound message and durable intent before the network call.
        const outboundId = randomUUID();
        await prisma.$transaction(async tx => {
          const reserved = await tx.inquiryJob.updateMany({ where: { messageId: job.messageId, status: 'checked', leaseToken: token, leaseUntil: { gt: new Date() } }, data: { status: 'sending', outboundId } });
          if (!reserved.count) throw new Error('SEND_LEASE_LOST');
          await tx.message.create({ data: { id: outboundId, eventId: job.eventId, propertyId: job.propertyId, guestName: current.message.guestName,
            text: job.draft, sender: 'host', automated: true, read: true, source: 'beds24', beds24BookingId: current.event.originalUid, deliveryStatus: 'sending' } });
        });
        try {
          const providerId = await deps.reply(current.event.originalUid!, job.draft);
          await prisma.$transaction([
            prisma.message.update({ where: { id: outboundId }, data: { deliveryStatus: 'sent', beds24MessageId: providerId } }),
            prisma.inquiryJob.update({ where: { messageId: job.messageId }, data: { status: 'sent', leaseToken: null, leaseUntil: null } }),
          ]);
        } catch {
          await prisma.message.update({ where: { id: outboundId }, data: { deliveryStatus: 'unknown' } });
          await escalate(job, '자동답변 접수 여부를 확인할 수 없습니다. 중복 발송을 피하려면 Beds24 발송 내역을 확인해 주세요.');
        }
      } finally { await releaseInquirySend(job.eventId, sendToken); }
    }
  } catch {
    // Do not log guest content, prompt, credentials or raw provider errors.
    await escalate(job, '자동답변 처리에 실패했습니다. 담당자가 확인해 주세요.');
  }
  return true;
}

export async function processInquiryNotification(deps: Dependencies = defaults): Promise<boolean> {
  // Recover interrupted alert submissions as unknown, never duplicate an ambiguous send.
  await prisma.inquiryNotification.updateMany({ where: { status: 'sending', updatedAt: { lt: new Date(Date.now() - leaseMs) } },
    data: { status: 'unknown', error: '알림톡 접수 중 연결이 종료되었습니다. 발송 내역 확인이 필요합니다.' } });
  const notification = await prisma.inquiryNotification.findFirst({ where: { status: { in: ['pending', 'failed'] }, attempts: { lt: 3 }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' } });
  if (!notification) return false;
  const job = await prisma.inquiryJob.findUnique({ where: { messageId: notification.jobId } });
  if (!job) return false;
  const recipients = await getInquiryNotificationRecipients(job.propertyId);
  const conversation = await prisma.inquiryConversation.findUnique({ where: { eventId: job.eventId } });
  if (!recipients.some(recipient => recipient.phone === notification.phone) || (conversation?.resumeAfter && conversation.resumeAfter >= job.createdAt)) {
    await prisma.inquiryNotification.update({ where: { id: notification.id }, data: { status: 'cancelled' } }); return true;
  }
  const claimed = await prisma.inquiryNotification.updateMany({ where: { id: notification.id, status: notification.status, attempts: notification.attempts }, data: { status: 'sending', attempts: notification.attempts + 1 } });
  if (!claimed.count) return true;
  const [property, message] = await Promise.all([
    prisma.property.findUnique({ where: { id: job.propertyId }, select: { name: true } }),
    prisma.message.findUnique({ where: { id: job.messageId }, select: { guestName: true } }),
  ]);
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://voidanchae.com';
  const url = new URL('/admin/messages', origin);
  url.searchParams.set('eventId', job.eventId); url.searchParams.set('propertyId', job.propertyId); url.searchParams.set('guestName', message?.guestName || '게스트');
  const result = await deps.kakao({ phone: notification.phone, name: recipients.find(recipient => recipient.phone === notification.phone)!.name,
    property: property?.name || '숙소', guest: message?.guestName || '게스트', summary: job.summary || '고객 문의 확인이 필요합니다.', reason: job.reason, url: url.toString() });
  await prisma.inquiryNotification.update({ where: { id: notification.id }, data: { status: result.status, providerMessageId: result.providerMessageId, error: result.error ?? null, nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
  return true;
}
