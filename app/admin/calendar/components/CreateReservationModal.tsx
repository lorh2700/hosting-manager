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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[#161616] border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CalendarPlus size={14} className="text-indigo-300" />
            <h3 className="text-white font-light text-base">예약 등록</h3>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-[11px] text-white/50 leading-relaxed">
            Beds24에 <span className="text-indigo-300">확정 예약</span>을 등록해 해당 기간을 모든 채널에서 차단합니다.
          </p>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">숙소</label>
            <select
              value={propertyId}
              onChange={e => setPropertyId(e.target.value)}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
            >
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">체크인</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">체크아웃</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">예약자 이름</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동"
              maxLength={80}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/25"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">이메일 (선택)</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="guest@example.com"
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/25"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">연락처 (선택)</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/25"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">성인</label>
              <input
                type="number"
                min="1" max="20"
                value={numAdult}
                onChange={e => setNumAdult(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">아동</label>
              <input
                type="number"
                min="0" max="20"
                value={numChild}
                onChange={e => setNumChild(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">추가 정보 (선택)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="메모, 요청사항, 픽업 장소 등"
              className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 placeholder:text-white/25 resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">태그 (선택)</label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-[11px] bg-white/10 text-white/80 border border-white/10 rounded-full">
                    {t}
                    <button type="button" onClick={() => removeTag(t)} className="p-0.5 text-white/40 hover:text-white">
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
                className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-white/30 placeholder:text-white/25"
              />
              <button
                type="button"
                onClick={() => addTag(newTag)}
                disabled={!newTag.trim()}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white/70 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-30 flex items-center gap-1"
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
                  className="text-[10px] px-2 py-0.5 border border-white/[0.07] text-white/40 hover:text-white/80 hover:border-white/20 rounded-full transition-colors"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-white/10 hover:border-white/30 text-white/60 hover:text-white rounded-lg text-[11px] tracking-widest font-semibold transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-white text-black hover:bg-white/90 rounded-lg text-[11px] tracking-widest font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? '등록 중...' : '예약 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
