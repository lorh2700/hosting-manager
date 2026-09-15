import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/http';

export async function ensureInquiryConversation(eventId: string) {
  return prisma.inquiryConversation.upsert({ where: { eventId }, create: { eventId }, update: {} });
}

// A short send lease serializes manual sends, pause/resume and automated sends.
// No takeover while an external send is in flight. Durable job.send status is NEVER retried.
export async function acquireInquirySend(eventId: string, manual = false): Promise<string | null> {
  await ensureInquiryConversation(eventId);
  const token = randomUUID();
  const locked = await prisma.inquiryConversation.updateMany({
    where: { eventId, ...(manual ? {} : { paused: false }), OR: [{ sendToken: null }, { sendUntil: { lt: new Date() } }] },
    data: { sendToken: token, sendUntil: new Date(Date.now() + 120_000), ...(manual ? { paused: true, reason: '담당자가 직접 응대 중입니다.' } : {}) },
  });
  return locked.count === 1 ? token : null;
}

export async function releaseInquirySend(eventId: string, token: string) {
  await prisma.inquiryConversation.updateMany({ where: { eventId, sendToken: token }, data: { sendToken: null, sendUntil: null } });
}

export async function setInquiryPaused(eventId: string, paused: boolean, reason = '담당자가 직접 응대 중입니다.') {
  await ensureInquiryConversation(eventId);
  const result = await prisma.inquiryConversation.updateMany({
    where: { eventId, OR: [{ sendToken: null }, { sendUntil: { lt: new Date() } }] },
    data: { paused, reason: paused ? reason : null, ...(!paused ? { resumeAfter: new Date() } : {}), sendToken: null, sendUntil: null },
  });
  if (result.count !== 1) throw fail(409, '메시지를 전송 중입니다. 잠시 후 다시 시도해 주세요.');
}
