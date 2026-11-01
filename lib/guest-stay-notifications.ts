import { getInquiryNotificationRecipients } from '@/lib/inquiry-notification-recipients';
import { getNotifier, type NotifyProvider } from '@/lib/notify';
import type { GuestStayRequestDTO } from '@/lib/guest-stay';

type Stay = { propertyId: string; guestName: string; checkIn: string; checkOut: string; property: { name: string } };
type Dependencies = {
  recipients: typeof getInquiryNotificationRecipients;
  notifier: () => NotifyProvider;
};
const defaults: Dependencies = { recipients: getInquiryNotificationRecipients, notifier: getNotifier };
const labels = { tour: '투어 신청', taxi: '택시·픽업 신청', help: '객실 요청', interim_cleaning: '중간청소 신청' };
const helpLabels = { supplies: '비품', issue: '시설 문제', other: '기타' };
const clean = (value: string, limit = 120) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);

export function guestStayNotificationText(stay: Stay, request: GuestStayRequestDTO) {
  const details = request.details;
  const lines = ['[void anchae 게스트 신청]', `${clean(stay.property.name, 80)} · ${labels[request.kind]}`,
    `예약자: ${clean(stay.guestName, 80)}`, `숙박: ${stay.checkIn} ~ ${stay.checkOut}`,
    `접수: ${request.source === 'pad' ? '객실 패드' : '게스트 앱'}`];
  if ('date' in details) lines.push(`희망 일정: ${details.date} ${details.time}`);
  if ('destination' in details) lines.push(`목적지: ${clean(details.destination)}`, `인원 ${details.passengers}명 · 짐 ${details.luggage}개`);
  if ('tourId' in details) lines.push(`투어: ${clean(request.tourTitle || request.tourSnapshot?.title || '선택 투어')}`,
    ...(request.durationTitle ? [`코스: ${clean(request.durationTitle)}`] : []), `인원: ${details.guests}명`);
  if ('category' in details) lines.push(`분류: ${helpLabels[details.category]}`, `내용: ${clean(details.message, 240)}`);
  if ('note' in details && details.note) lines.push(`메모: ${clean(details.note, 240)}`);
  const suffix = `\n접수번호: ${request.id}`;
  let text = lines.join('\n');
  if (Buffer.byteLength(text + suffix, 'utf8') > 1800) {
    let shortened = '';
    for (const character of text) {
      if (Buffer.byteLength(shortened + character + '…' + suffix, 'utf8') > 1800) break;
      shortened += character;
    }
    text = shortened + '…';
  }
  return text + suffix;
}

export async function notifyGuestStayRequest(stay: Stay, request: GuestStayRequestDTO, deps: Dependencies = defaults) {
  const context = { requestId: request.id, propertyId: stay.propertyId, kind: request.kind, source: request.source };
  try {
    const recipients = await deps.recipients(stay.propertyId);
    if (!recipients.length) {
      console.warn('[guest-stay-notify]', { ...context, status: 'no_recipients' });
      return;
    }
    const notifier = deps.notifier();
    if (notifier.name === 'noop') {
      console.warn('[guest-stay-notify]', { ...context, status: 'provider_unconfigured' });
      return;
    }
    const text = guestStayNotificationText(stay, request);
    await Promise.all(recipients.map(async (recipient, recipientIndex) => {
      try {
        const result = await notifier.sendSms({ to: recipient.phone, text, signal: AbortSignal.timeout(8000) });
        const status = result.ok && result.messageId ? 'accepted'
          : result.ok || result.deliveryUnknown ? 'delivery_unknown' : 'failed';
        const record = { ...context, recipientIndex, status, provider: result.provider,
          ...(status === 'accepted' ? { messageId: result.messageId } : {}) };
        if (status === 'accepted') console.info('[guest-stay-notify]', record);
        else console.warn('[guest-stay-notify]', record);
      } catch {
        console.warn('[guest-stay-notify]', { ...context, recipientIndex, status: 'delivery_unknown' });
      }
    }));
  } catch {
    console.warn('[guest-stay-notify]', { ...context, status: 'notification_failed' });
  }
}
