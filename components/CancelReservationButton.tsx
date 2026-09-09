'use client';
import { useState } from 'react';
import { confirmDialog, toast } from '@/components/ui';
export function CancelReservationButton({ eventId, source, onCancelled }: { eventId: string; source?: string | null; onCancelled: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!['manual-reservation', 'Beds24', 'direct'].includes(source ?? '')) return null;
  async function cancel() {
    if (busy || !(await confirmDialog('이 직접 예약을 취소할까요? Beds24에서 취소 상태를 확인한 뒤 캘린더와 청소 일정에 반영합니다.'))) return;
    setBusy(true);
    try {
      const res = await fetch('/api/beds24/reservations?eventId=' + encodeURIComponent(eventId), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '예약 취소에 실패했습니다.');
      toast.success('예약이 취소되었습니다.');
      if (data.cleaningCleanupPending) toast.error('예약은 취소되었지만 청소 일정 정리가 지연됩니다. 동기화 후 청소 일정을 확인해 주세요.');
      onCancelled();
    } catch (e) { toast.error(e instanceof Error ? e.message : '예약 취소에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <button type="button" disabled={busy} onClick={cancel} className="w-full min-h-11 border border-red-200 text-red-700 rounded-lg px-3 py-3 disabled:opacity-50">{busy ? 'Beds24 취소 확인 중…' : '직접 예약 취소'}</button>;
}
