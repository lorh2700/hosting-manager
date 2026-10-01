import type { OpsProperty } from '../app/api/ops/today/route';

export type OpsNextAction = { label: string; tone: 'neutral' | 'warning' | 'danger'; kind: 'unknown' | 'checkout' | 'assign' | 'cleaning' | 'message' };

export function needsOpsCleaning(property: OpsProperty): boolean {
  return property.checkouts.length > 0 || !!property.cleaning;
}

/** An accepted room-ready message is a separate task from cleaning and checkout. */
export function opsNextAction(property: OpsProperty, detailsReady: boolean, delivery: Record<string, string> = {}): OpsNextAction | null {
  if (!property.hasWork) return null;
  if (!detailsReady) return { label: '운영 정보 확인', tone: 'warning', kind: 'unknown' };
  if (property.checkouts.length && !property.checkoutStatus?.confirmed) return { label: '퇴실 확인', tone: 'warning', kind: 'checkout' };
  if (needsOpsCleaning(property) && property.cleaning?.status !== 'done') {
    return property.cleaning?.cleanerId
      ? { label: '청소 진행 확인', tone: 'neutral', kind: 'cleaning' }
      : { label: '담당자 배정', tone: 'warning', kind: 'assign' };
  }
  const unsent = property.checkins.filter(reservation => reservation.hasChat && (delivery[reservation.id] ?? reservation.readyDelivery) !== 'sent');
  if (unsent.length) {
    const failed = unsent.some(reservation => {
      const state = delivery[reservation.id] ?? reservation.readyDelivery;
      return state && !['sending', 'pending', 'queued'].includes(state);
    });
    return { label: failed ? '안내 전송 확인' : '입실 안내 확인', tone: failed ? 'danger' : 'neutral', kind: 'message' };
  }
  return null;
}

export function opsCleaningLabel(property: OpsProperty, detailsReady: boolean): string {
  if (!detailsReady && property.hasWork) return '확인 필요';
  if (!needsOpsCleaning(property)) return '청소 없음';
  if (property.cleaning?.status === 'done') return '완료';
  return property.cleaning?.cleanerId ? '배정 완료' : '미배정';
}

export function opsDeliveryLabel(state?: string | null): string {
  if (state === 'sent') return 'Beds24 접수 완료';
  if (state === 'sending') return '전송 중';
  if (state === 'pending' || state === 'queued') return '전송 대기';
  if (state === 'local_only') return '내부 기록 · 게스트 미전송';
  return state ? '전송 확인 필요' : '전송 기록 없음';
}
