'use client';

import { useState } from 'react';
import { X, Wrench, ShieldCheck } from 'lucide-react';

interface CreateMaintenanceModalProps {
  properties: Array<{ id: string; name: string }>;
  defaultPropertyId?: string;
  onClose: () => void;
  onCreated: () => void;
}

interface MaintenanceApiResponse {
  success?: boolean;
  eventId?: string;
  beds24BookingId?: string;
  error?: string;
  pendingBeds24BookingId?: string;
  clearPending?: boolean;
}

function fallbackErrorMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return '서버 응답이 없습니다 (시간 초과). Beds24에는 이미 등록됐을 수 있으니 잠시 후 다시 "정비 등록"을 누르세요. 같은 차단이 있으면 중복 없이 확인 후 등록됩니다.';
  }
  return `정비 등록에 실패했습니다. (HTTP ${status})`;
}

/**
 * 객실정비(유지보수) 차단 등록.
 * Beds24 에 블랙아웃을 만들어 모든 채널을 막는다. 청소·담당자 알림·빨래 업체 캘린더 피드에는
 * 아무것도 남기지 않으므로 그쪽에서는 공실로 보인다.
 */
export function CreateMaintenanceModal({ properties, defaultPropertyId, onClose, onCreated }: CreateMaintenanceModalProps) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBeds24BookingId, setPendingBeds24BookingId] = useState<string | null>(null);
  const isPending = pendingBeds24BookingId !== null;

  const requestClose = () => {
    if (saving) return;
    if (isPending) {
      const ok = window.confirm(
        `Beds24에는 정비 차단 #${pendingBeds24BookingId}이(가) 이미 생성되어 있지만 플랫폼 등록은 아직 완료되지 않았습니다.\n\n` +
        `지금 닫으면 이 화면에서 이어서 등록할 수 없습니다. (다음 Beds24 동기화 때 자동으로 반영됩니다.)\n\n그래도 닫을까요?`,
      );
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!propertyId || !startDate || !endDate) {
      setError('숙소와 시작일, 종료일은 필수입니다.');
      return;
    }
    if (startDate >= endDate) {
      setError('종료일(차단이 풀리는 날)은 시작일보다 뒤여야 합니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/beds24/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId, startDate, endDate,
          reason: reason.trim(),
          beds24BookingId: pendingBeds24BookingId ?? undefined,
        }),
      });
      let data: MaintenanceApiResponse | null = null;
      try { data = (await res.json()) as MaintenanceApiResponse; } catch { data = null; }

      if (!res.ok) {
        if (data?.pendingBeds24BookingId) setPendingBeds24BookingId(String(data.pendingBeds24BookingId));
        else if (data?.clearPending) setPendingBeds24BookingId(null);
        setError(data?.error || fallbackErrorMessage(res.status));
        return;
      }
      setPendingBeds24BookingId(null);
      onCreated();
    } catch (err) {
      const base = err instanceof Error ? err.message : '정비 등록 중 오류가 발생했습니다.';
      setError(`${base} 네트워크 상태를 확인한 뒤 다시 시도해주세요.`);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-white border border-stone-200 px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors placeholder:text-stone-400 disabled:bg-stone-50 disabled:text-stone-500 disabled:cursor-not-allowed';
  const labelCls = 'block text-xs text-stone-500 mb-1.5';

  const nights = startDate && endDate && startDate < endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    : 0;

  const submitLabel = saving
    ? (isPending ? 'Beds24 확인 중...' : 'Beds24 차단·확인 중...')
    : (isPending ? 'Beds24 확인 후 등록' : '정비 등록');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm p-4" onClick={requestClose}>
      <div
        className="bg-white border border-stone-200 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <Wrench size={15} className="text-slate-600" />
            <h3 className="text-stone-900 font-semibold text-base">객실정비 등록</h3>
          </div>
          <button onClick={requestClose} className="text-stone-500 hover:text-stone-900 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-stone-500 leading-relaxed">
            Beds24에 <span className="font-medium text-stone-700">차단(블랙아웃)</span>을 만들어 해당 기간을 모든 채널에서 막습니다.
            예약이 아니므로 청소가 열리지 않고, 담당자 알림과 빨래 업체 캘린더에도 올라가지 않습니다.
          </p>

          {isPending && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 space-y-1.5">
              <p className="flex items-center gap-1.5 font-medium">
                <ShieldCheck size={13} />
                Beds24 차단 #{pendingBeds24BookingId} 생성됨 · 플랫폼 등록 대기
              </p>
              <p className="leading-relaxed text-amber-800">
                아래 버튼을 누르면 Beds24에서 이 차단을 다시 확인한 뒤 플랫폼에 등록합니다. 새 차단은 만들지 않습니다.
              </p>
            </div>
          )}

          <div>
            <label className={labelCls}>숙소</label>
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)} disabled={isPending} className={inputCls}>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>정비 시작일</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={isPending} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>차단 해제일</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={isPending} className={inputCls} />
            </div>
          </div>
          <p className="text-[11px] text-stone-400 -mt-2">
            예약과 같은 규칙입니다. 하루만 막으려면 해제일을 다음 날로 두세요.{nights > 0 ? ` (${nights}박 차단)` : ''}
          </p>

          <div>
            <label className={labelCls}>사유 (선택)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="보일러 점검, 도배, 가구 교체 등"
              maxLength={200}
              className={inputCls}
            />
            <p className="text-[11px] text-stone-400 mt-1">Beds24 메모에 &quot;객실정비: 사유&quot; 형태로 저장되어 어디서 봐도 정비로 구분됩니다.</p>
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 leading-relaxed">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-stone-700 hover:text-stone-900 text-sm font-medium transition-colors disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-slate-700 text-white hover:bg-slate-800 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
