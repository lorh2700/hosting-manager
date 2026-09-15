import { createHmac, randomBytes } from 'crypto';
import { z } from 'zod';
import { beds24Post, beds24Get } from '@/lib/beds24';
import type { InquiryContext } from '@/lib/inquiry-ai';

export function inquiryDeliveryReadiness(): string[] {
  const missing: string[] = [];
  if (!process.env.OPENAI_API_KEY?.trim()) missing.push('GPT 연결');
  if (!process.env.BEDS24_REFRESH_TOKEN?.trim()) missing.push('Beds24 연결');
  if (!process.env.CRON_SECRET?.trim()) missing.push('자동처리 연결');
  if (!['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PFID', 'SOLAPI_FROM'].every(key => !!process.env[key]?.trim())) missing.push('카카오톡 발신 설정');
  if (!process.env.SOLAPI_TPL_INQUIRY_ESCALATED?.trim()) missing.push('고객 문의 알림톡 템플릿');
  return missing;
}

export function confirmedBeds24Message(result: unknown): { messageId: string | null } | null {
  const parsed = z.array(z.object({ success: z.literal(true), errors: z.array(z.unknown()).optional(), new: z.object({ id: z.union([z.string(), z.number()]).optional() }).nullish() })).safeParse(result);
  if (!parsed.success || parsed.data.length !== 1) return null;
  if (parsed.data[0].errors?.length) return null;
  const id = String(parsed.data[0].new?.id ?? '');
  // Beds24 also documents successful message responses containing only success + info.
  // A provider id is optional; a later sync merges the echo into our persisted outbound row.
  return { messageId: /^\d+$/.test(id) ? id : null };
}

export async function sendInquiryReply(bookingId: string, text: string) {
  const result: unknown = await beds24Post('/bookings/messages', [{ bookingId: Number(bookingId), message: text }], { timeoutMs: 8000, noRetry: true });
  const receipt = confirmedBeds24Message(result);
  if (!receipt) throw new Error('BEDS24_RECEIPT_UNCONFIRMED');
  return receipt.messageId;
}

export async function checkInquiryReservation(bookingId: string, propertyId: string, reservation: InquiryContext['reservation']): Promise<boolean> {
  const response = await beds24Get('/bookings', { id: bookingId }, { timeoutMs: 8000, noRetry: true });
  const count = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).optional();
  const parsed = z.array(z.object({ id: z.number(), propertyId: z.number(), status: z.string(), arrival: z.string(), departure: z.string(), numAdult: count, numChild: count, numAdults: count, numChildren: count })).safeParse(Array.isArray(response) ? response : response?.data);
  if (!parsed.success || parsed.data.length !== 1) return false;
  const booking = parsed.data[0];
  return String(booking.id) === bookingId && String(booking.propertyId) === propertyId
    && ['confirmed', 'new', 'request', 'inquiry'].includes(booking.status)
    && booking.arrival === reservation.checkIn && booking.departure === reservation.checkOut
    && (reservation.adults === null || (booking.numAdult ?? booking.numAdults ?? 0) === reservation.adults)
    && (reservation.children === null || (booking.numChild ?? booking.numChildren ?? 0) === reservation.children);
}

/** Recheck the channel before sending: a human may have replied outside this app. */
export async function checkInquiryRemote(bookingId: string, messageId: string): Promise<'unchanged' | 'changed'> {
  const response = await beds24Get('/bookings/messages', { bookingId, maxAge: '3' }, { timeoutMs: 8000, noRetry: true });
  if (response?.pages?.nextPageExists) return 'changed';
  const data = z.array(z.object({ id: z.union([z.string(), z.number()]), source: z.string(), time: z.string().optional(), datetime: z.string().optional() })).parse(Array.isArray(response) ? response : response?.data);
  const relevant = data.filter(item => item.source === 'guest' || item.source === 'host');
  if (relevant.length === 0 || relevant.some(item => !Number.isFinite(Date.parse(item.time || item.datetime || '')))) return 'changed';
  relevant.sort((a, b) => Date.parse(b.time || b.datetime!) - Date.parse(a.time || a.datetime!) || Number(b.id) - Number(a.id));
  return relevant[0].source === 'guest' && String(relevant[0].id) === messageId ? 'unchanged' : 'changed';
}

export type AlertReceipt = { status: 'accepted' | 'failed' | 'unknown'; providerMessageId?: string; error?: string };
export async function sendInquiryKakao(input: { phone: string; name: string; property: string; guest: string; summary: string; reason: string; url: string }): Promise<AlertReceipt> {
  if (!['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PFID', 'SOLAPI_FROM', 'SOLAPI_TPL_INQUIRY_ESCALATED'].every(key => !!process.env[key]?.trim())) return { status: 'failed', error: '카카오 알림톡 설정이 필요합니다.' };
  const date = new Date().toISOString(), salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', process.env.SOLAPI_API_SECRET!).update(date + salt).digest('hex');
  try {
    const response = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', Authorization: `HMAC-SHA256 apiKey=${process.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` },
      body: JSON.stringify({ message: { to: input.phone, from: process.env.SOLAPI_FROM, type: 'ATA',
        kakaoOptions: { pfId: process.env.SOLAPI_PFID, templateId: process.env.SOLAPI_TPL_INQUIRY_ESCALATED, disableSms: true,
          variables: { '#{수신자명}': input.name, '#{숙소명}': input.property, '#{게스트명}': input.guest,
            '#{문의요약}': input.summary, '#{확인사유}': input.reason, '#{상담링크}': input.url } } } }),
    });
    if (!response.ok) return { status: response.status >= 500 || response.status === 408 ? 'unknown' : 'failed', error: `알림톡 접수 오류 (${response.status})` };
    const data = z.object({ messageId: z.string().min(1), statusCode: z.string().optional() }).safeParse(await response.json());
    if (!data.success) return { status: 'unknown', error: '알림톡 접수 결과를 확인할 수 없습니다.' };
    if (data.data.statusCode && !data.data.statusCode.startsWith('2')) return { status: 'failed', error: `알림톡 접수 거부 (${data.data.statusCode})` };
    return { status: 'accepted', providerMessageId: data.data.messageId };
  } catch { return { status: 'unknown', error: '알림톡 접수 여부가 불명확합니다. 발송 내역 확인이 필요합니다.' }; }
}
