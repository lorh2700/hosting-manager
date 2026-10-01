import { inquiryReplyDestination } from '@/lib/inquiry-platform';

export type ReplyTarget = { label: string; isBeds24: boolean };

/** The channel name is reservation data; Beds24 is only the transport. */
export function conversationReplyTarget(source: string | null | undefined, channelId?: string | null, originalUid?: string | null): ReplyTarget {
  const isBeds24 = channelId === 'beds24' && /^\d+$/.test(originalUid || '');
  return {
    label: isBeds24 ? inquiryReplyDestination(source) : '내부 메모 · 게스트에게 발송되지 않음',
    isBeds24,
  };
}

export type DeliveryPresentation = { label: string; detail: string; tone: 'neutral' | 'pending' | 'success' | 'warning' };

/** `sent` means a Beds24 receipt, not proof that an OTA delivered the message. */
export function messageDeliveryPresentation(message: { sender?: string; deliveryStatus?: string | null; type?: string | null; beds24MessageType?: string | null }): DeliveryPresentation | null {
  if (message.type === 'memo' || message.beds24MessageType === 'internalNote' || message.deliveryStatus === 'local_only') {
    return { label: '내부 메모', detail: '게스트에게 발송되지 않았습니다.', tone: 'neutral' };
  }
  if (message.sender !== 'host') return null;
  switch (message.deliveryStatus) {
    case 'queued': case 'sending':
      return { label: '접수 확인 중', detail: '플랫폼 도착은 아직 확인되지 않았습니다.', tone: 'pending' };
    case 'sent': case 'accepted':
      return { label: 'Beds24 접수 완료', detail: '예약 플랫폼 도착은 확인되지 않았습니다.', tone: 'success' };
    case 'delivered':
      return { label: '플랫폼 전달 완료', detail: '전달 상태가 확인된 메시지입니다.', tone: 'success' };
    case 'failed':
      return { label: '접수 실패', detail: '대화 기록은 저장됐습니다. Beds24에서 발송 내역을 확인해 주세요.', tone: 'warning' };
    case 'unknown':
      return { label: '접수 여부 확인 필요', detail: '중복 발송 전에 Beds24에서 발송 내역을 확인해 주세요.', tone: 'warning' };
    default:
      return { label: '전달 상태 미확인', detail: '게스트 수신 여부를 확인할 수 없습니다.', tone: 'neutral' };
  }
}
