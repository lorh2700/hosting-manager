'use client';

import { useState } from 'react';
import { X, CalendarPlus, Plus } from 'lucide-react';
import type { RawEvent } from '../types';

interface CreateReservationModalProps {
  properties: Array<{ id: string; name: string }>;
  defaultPropertyId?: string;
  onClose: () => void;
  onCreated: (event: RawEvent) => void;
}

const PRESET_TAGS = ['픽업 요청', '늦은 체크인', '일찍 체크인', '반려동물', '유아 동반', '조용한 객실'];

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

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || tags.includes(t) || tags.length >= 20 || t.length > 40) return;
    setTags(prev => [...prev, t]);
    setNewTag('');
  };
  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '예약 등록에 실패했습니다.');
        return;
      }

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
      setError(err instanceof Error ? err.message : '예약 등록 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-white border border-stone-200 px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors placeholder:text-stone-400';
  const labelCls = 'block text-xs text-stone-500 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white border border-stone-200 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <CalendarPlus size={15} className="text-[var(--brand)]" />
            <h3 className="text-stone-900 font-semibold text-base">예약 등록</h3>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-900 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-stone-500 leading-relaxed">
            Beds24에 <span className="text-[var(--brand)] font-medium">확정 예약</span>을 등록해 해당 기간을 모든 채널에서 차단합니다.
          </p>

          <div>
            <label className={labelCls}>숙소</label>
            <select
              value={propertyId}
              onChange={e => setPropertyId(e.target.value)}
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
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>체크아웃</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
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
                  className="text-[11px] px-2.5 py-0.5 bg-stone-100 text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-stone-700 hover:text-stone-900 text-sm font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)] text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? '등록 중...' : '예약 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
