'use client';

import { useState } from 'react';
import { X, CalendarPlus, Plus } from 'lucide-react';
import type { Property, RawEvent } from '../types';

interface CreateReservationModalProps {
  properties: Property[];
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

  const inputCls = 'w-full bg-black/30 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-violet-400/60 transition-colors placeholder:text-white/25';
  const labelCls = 'block text-xs text-white/55 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[#141416] border border-white/[0.08] rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <CalendarPlus size={15} className="text-violet-300" />
            <h3 className="text-white font-semibold text-base">예약 등록</h3>
          </div>
          <button onClick={onClose} className="text-white/45 hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-white/55 leading-relaxed">
            Beds24에 <span className="text-violet-300 font-medium">확정 예약</span>을 등록해 해당 기간을 모든 채널에서 차단합니다.
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
                  <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-xs bg-violet-500/15 text-violet-100 rounded-full">
                    {t}
                    <button type="button" onClick={() => removeTag(t)} className="p-0.5 text-violet-200/65 hover:text-white">
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
                className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-white/75 rounded-xl text-xs font-medium transition-colors disabled:opacity-30 flex items-center gap-1 shrink-0"
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
                  className="text-[11px] px-2.5 py-0.5 bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.08] rounded-full transition-colors"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-white/65 hover:text-white text-sm font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-violet-500 text-white hover:bg-violet-400 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? '등록 중...' : '예약 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
