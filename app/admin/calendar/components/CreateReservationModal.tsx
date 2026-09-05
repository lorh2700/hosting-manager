'use client';

import { useState } from 'react';
import { X, CalendarPlus, Plus, ShieldCheck } from 'lucide-react';
import type { RawEvent } from '../types';

interface CreateReservationModalProps {
  properties: Array<{ id: string; name: string }>;
  defaultPropertyId?: string;
  onClose: () => void;
  onCreated: (event: RawEvent) => void;
}

// /api/beds24/reservations 응답 (성공·실패 공통 필드)
interface ReservationApiResponse {
  success?: boolean;
  eventId?: string;
  beds24BookingId?: string;
  error?: string;
  stage?: 'create' | 'verify' | 'local';
  /** Beds24 에는 예약이 생성됐지만 확인/플랫폼 저장이 안 된 경우 — 재시도 시 이 id 를 되돌려보낸다. */
  pendingBeds24BookingId?: string;
  /** 보관 중인 pending id 를 버려야 하는 경우. */
  clearPending?: boolean;
  origin?: 'created' | 'reused' | 'recovered' | 'provided';
}

const PRESET_TAGS = ['픽업 요청', '늦은 체크인', '일찍 체크인', '반려동물', '유아 동반', '조용한 객실'];

// 서버가 JSON 을 못 돌려준 경우 (게이트웨이 타임아웃 등) 의 안내 문구.
function fallbackErrorMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return '서버 응답이 없습니다 (시간 초과). Beds24에는 이미 등록됐을 수 있으니 잠시 후 다시 "예약 등록"을 누르세요. 같은 예약이 있으면 중복 없이 확인 후 등록됩니다.';
  }
  return `예약 등록에 실패했습니다. (HTTP ${status})`;
}

export function CreateReservationModal({ properties, defaultPropertyId, onClose, onCreated }: CreateReservationModalProps) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [numAdult, setNumAdult] = useState('2');
  const [numChild, setNumChild] = useState('0');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Beds24 에는 생성됐지만 최종 확인/플랫폼 저장이 끝나지 않은 예약 id.
  // 이 값이 있으면 다음 제출은 새 예약을 만들지 않고 해당 예약을 확인만 한 뒤 플랫폼에 등록한다.
  const [pendingBeds24BookingId, setPendingBeds24BookingId] = useState<string | null>(null);
  const isPending = pendingBeds24BookingId !== null;

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || tags.includes(t) || tags.length >= 20 || t.length > 40) return;
    setTags(prev => [...prev, t]);
    setNewTag('');
  };
  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const requestClose = () => {
    if (saving) return;
    if (isPending) {
      const ok = window.confirm(
        `Beds24에는 예약 #${pendingBeds24BookingId}이(가) 이미 생성되어 있지만 플랫폼 등록은 아직 완료되지 않았습니다.\n\n` +
        `지금 닫으면 이 화면에서 이어서 등록할 수 없습니다. (다음 Beds24 동기화 때 일반 Beds24 예약으로 자동 반영되지만 태그·메모는 포함되지 않습니다.)\n\n` +
        `그래도 닫을까요?`,
      );
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!propertyId || !startDate || !endDate || !name.trim()) {
      setError('숙소, 체크인/체크아웃, 이름은 필수입니다.');
      return;
    }
    if (startDate >= endDate) {
      setError('체크아웃은 체크인보다 뒤여야 합니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/beds24/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId, startDate, endDate,
          name: name.trim(), email: email.trim(), phone: phone.trim(),
          numAdult: Number(numAdult) || 1, numChild: Number(numChild) || 0,
          notes: notes.trim(), tags,
          beds24BookingId: pendingBeds24BookingId ?? undefined,
        }),
      });

      let data: ReservationApiResponse | null = null;
      try {
        data = (await res.json()) as ReservationApiResponse;
      } catch {
        data = null;
      }

      if (!res.ok) {
        if (data?.pendingBeds24BookingId) {
          setPendingBeds24BookingId(String(data.pendingBeds24BookingId));
        } else if (data?.clearPending) {
          setPendingBeds24BookingId(null);
        }
        setError(data?.error || fallbackErrorMessage(res.status));
        return;
      }

      if (!data?.eventId) {
        setError('서버 응답을 해석할 수 없습니다. 캘린더를 새로고침해 등록 여부를 확인해주세요.');
        return;
      }

      setPendingBeds24BookingId(null);

      const adults = Number(numAdult) || 1;
      const children = Number(numChild) || 0;
      const descriptionParts = [
        `게스트: ${name.trim()}`,
        email.trim() ? `이메일: ${email.trim()}` : '',
        phone.trim() ? `연락처: ${phone.trim()}` : '',
        `인원: 성인 ${adults}명${children > 0 ? `, 아동 ${children}명` : ''}`,
        `채널: 직접 등록`,
        notes.trim() ? `메모: ${notes.trim()}` : '',
      ].filter(Boolean).join('\n');

      onCreated({
        id: data.eventId,
        propertyId,
        channelId: 'beds24',
        source: 'manual-reservation',
        title: name.trim(),
        start: startDate,
        end: endDate,
        type: 'reservation',
        description: descriptionParts,
        tags,
        originalUid: data.beds24BookingId ?? null,
      });
    } catch (err) {
      const base = err instanceof Error ? err.message : '예약 등록 중 오류가 발생했습니다.';
      setError(`${base} 네트워크 상태를 확인한 뒤 다시 시도해주세요. 같은 예약이 Beds24에 이미 생성돼 있으면 중복 없이 이어서 등록됩니다.`);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-white border border-stone-200 px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors placeholder:text-stone-400 disabled:bg-stone-50 disabled:text-stone-500 disabled:cursor-not-allowed';
  const labelCls = 'block text-xs text-stone-500 mb-1.5';

  const submitLabel = saving
    ? (isPending ? 'Beds24 확인 중...' : 'Beds24 등록·확인 중...')
    : (isPending ? 'Beds24 확인 후 등록' : '예약 등록');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm p-4" onClick={requestClose}>
      <div
        className="bg-white border border-stone-200 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <CalendarPlus size={15} className="text-[var(--brand)]" />
            <h3 className="text-stone-900 font-semibold text-base">예약 등록</h3>
          </div>
          <button onClick={requestClose} className="text-stone-500 hover:text-stone-900 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-stone-500 leading-relaxed">
            Beds24에 <span className="text-[var(--brand)] font-medium">확정 예약</span>을 등록해 해당 기간을 모든 채널에서 차단합니다.
            Beds24에서 등록이 <span className="font-medium text-stone-700">확인된 뒤에만</span> 플랫폼 캘린더에 반영됩니다.
          </p>

          {isPending && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 space-y-1.5">
              <p className="flex items-center gap-1.5 font-medium">
                <ShieldCheck size={13} />
                Beds24 예약 #{pendingBeds24BookingId} 생성됨 · 플랫폼 등록 대기
              </p>
              <p className="leading-relaxed text-amber-800">
                아래 버튼을 누르면 Beds24에서 이 예약을 다시 확인한 뒤 플랫폼에 등록합니다. 새 예약은 만들지 않습니다.
              </p>
              <button
                type="button"
                onClick={() => { setPendingBeds24BookingId(null); setError(null); }}
                className="text-[13px] underline text-amber-700 hover:text-amber-900"
              >
                대기 중인 예약을 무시하고 처음부터 다시 입력
              </button>
            </div>
          )}

          <div>
            <label className={labelCls}>숙소</label>
            <select
              value={propertyId}
              onChange={e => setPropertyId(e.target.value)}
              disabled={isPending}
              className={inputCls}
            >
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>체크인</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                disabled={isPending}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>체크아웃</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                disabled={isPending}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>예약자 이름</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동"
              maxLength={80}
              disabled={isPending}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>이메일 (선택)</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="guest@example.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>연락처 (선택)</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>성인</label>
              <input
                type="number"
                min="1" max="20"
                value={numAdult}
                onChange={e => setNumAdult(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>아동</label>
              <input
                type="number"
                min="0" max="20"
                value={numChild}
                onChange={e => setNumChild(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>추가 정보 (선택)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="메모, 요청사항, 픽업 장소 등"
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className={labelCls}>태그 (선택)</label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-xs bg-[var(--brand-tint)] text-[var(--brand-dark)]">
                    {t}
                    <button type="button" onClick={() => removeTag(t)} className="p-0.5 text-[var(--brand)] hover:text-[var(--brand-dark)]">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag(newTag);
                  }
                }}
                placeholder="태그 입력 후 엔터"
                maxLength={40}
                className={inputCls + ' text-[13px]'}
              />
              <button
                type="button"
                onClick={() => addTag(newTag)}
                disabled={!newTag.trim()}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-medium transition-colors disabled:opacity-30 flex items-center gap-1 shrink-0"
              >
                <Plus size={12} /> 추가
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESET_TAGS.filter(p => !tags.includes(p)).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => addTag(p)}
                  className="text-[13px] px-2.5 py-0.5 bg-stone-100 text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 leading-relaxed">
              {error}
            </p>
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
              className="flex-1 px-4 py-2.5 bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)] text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
