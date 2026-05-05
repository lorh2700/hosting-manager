'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Clock, Users as UsersIcon, MapPin, Compass, Loader2, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Logo } from '@/components/Logo';

interface Slot {
  id: string;
  date: string;
  startTime: string;
  remaining: number;
}

interface DurationOption {
  id: string;
  label: string | null;
  durationMin: number;
  price: number;
}

interface TicketTier {
  id: string;
  label: string;
  price: number;
  notes: string | null;
}

interface PublicTourDetail {
  id: string;
  title: string;
  slug: string;
  category: string | null;
  description: string | null;
  meetingPoint: string | null;
  durationMin: number | null;
  basePrice: number | null;
  maxGroupSize: number | null;
  images: string[];
  durationOptions: DurationOption[];
  ticketTiers: TicketTier[];
  slots: Slot[];
}

const LANGUAGE_OPTIONS = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
];

const MEETING_OPTIONS = [
  { value: 'anguk_station', label: '안국역 1번 출구' },
  { value: 'accommodation', label: '숙소 픽업' },
];

function formatDuration(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export default function PublicTourDetailPage() {
  const { slug } = useParams() as { slug: string };
  const [tour, setTour] = useState<PublicTourDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [tierCounts, setTierCounts] = useState<Record<string, number>>({});
  const [guests, setGuests] = useState(1);
  const [language, setLanguage] = useState<string>('ko');
  const [meetingChoice, setMeetingChoice] = useState<string>('anguk_station');
  const [meetingDetail, setMeetingDetail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/tours/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setTour(data);
          if (data.durationOptions?.length) setSelectedOptionId(data.durationOptions[0].id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const slotsByDate = useMemo(() => {
    if (!tour) return new Map<string, Slot[]>();
    const map = new Map<string, Slot[]>();
    tour.slots.forEach(s => {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    });
    return map;
  }, [tour]);

  const selectedSlot = tour?.slots.find(s => s.id === selectedSlotId) ?? null;
  const selectedOption = tour?.durationOptions.find(o => o.id === selectedOptionId) ?? null;
  const hasTiers = (tour?.ticketTiers.length ?? 0) > 0;

  // Tier-aware totals
  const tierTotalCount = useMemo(
    () => Object.values(tierCounts).reduce((s, n) => s + n, 0),
    [tierCounts],
  );
  const tierTotalPrice = useMemo(() => {
    if (!tour) return 0;
    return tour.ticketTiers.reduce(
      (sum, t) => sum + (tierCounts[t.id] ?? 0) * t.price,
      0,
    );
  }, [tour, tierCounts]);

  const effectiveCount = hasTiers ? tierTotalCount : guests;
  const totalPrice = hasTiers
    ? tierTotalPrice
    : ((selectedOption?.price ?? tour?.basePrice ?? null) !== null
        ? (selectedOption?.price ?? tour?.basePrice ?? 0) * guests
        : null);

  const adjustTier = (tierId: string, delta: number) => {
    setTierCounts(prev => {
      const next = Math.max(0, (prev[tierId] ?? 0) + delta);
      return { ...prev, [tierId]: next };
    });
  };

  const submit = async () => {
    if (!selectedSlotId || !name) {
      setError('이름과 시간을 선택해주세요.');
      return;
    }
    if (hasTiers && tierTotalCount === 0) {
      setError('인원을 1명 이상 선택해주세요.');
      return;
    }
    if (!hasTiers && !guests) {
      setError('인원을 선택해주세요.');
      return;
    }
    if ((tour?.durationOptions.length ?? 0) > 0 && !selectedOptionId) {
      setError('코스를 선택해주세요.');
      return;
    }
    if (meetingChoice === 'accommodation' && !meetingDetail.trim()) {
      setError('숙소명을 입력해주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const tickets = hasTiers
        ? Object.entries(tierCounts)
            .filter(([, n]) => n > 0)
            .map(([tierId, count]) => ({ tierId, count }))
        : undefined;
      const res = await fetch('/api/public/tour-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: selectedSlotId,
          durationOptionId: selectedOptionId,
          tickets,
          language,
          meetingChoice,
          meetingDetail: meetingChoice === 'accommodation' ? meetingDetail.trim() : null,
          name, phone, email, message,
          guests: hasTiers ? undefined : guests,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '예약에 실패했습니다.');
        return;
      }
      setSuccess(true);
    } catch (err) {
      console.error(err);
      setError('서버 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0C0A09] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-stone-500" />
      </div>
    );
  }

  if (!tour) {
    return (
      <div className="min-h-screen bg-[#0C0A09] flex items-center justify-center">
        <div className="text-center">
          <Compass size={32} strokeWidth={1.5} className="mx-auto mb-4 text-stone-700" />
          <p className="text-stone-400 text-sm mb-3">투어를 찾을 수 없습니다.</p>
          <Link href="/tours" className="text-xs uppercase tracking-widest text-stone-300 hover:text-white underline">
            투어 목록
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0C0A09] flex items-center justify-center px-6 text-stone-50">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
            <Check size={26} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-light tracking-tight mb-3">예약이 접수되었습니다</h2>
          <p className="text-stone-400 text-sm mb-8 font-light leading-relaxed">
            운영업체에 자동으로 통보되며, 확정 후 입력하신 연락처로 안내드립니다.
          </p>
          <Link
            href="/tours"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-stone-200 hover:text-white border border-white/20 hover:border-white/50 px-5 py-3 transition-colors"
          >
            다른 투어 보기 <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    );
  }

  const heroImage = tour.images[heroIndex] ?? tour.images[0];

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 font-sans selection:bg-stone-400/20">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex justify-between items-center px-6 md:px-8 h-16 md:h-[72px]">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity">
            <Logo width={140} priority />
          </Link>
          <Link href="/tours" className="text-xs uppercase tracking-widest text-stone-300 hover:text-white transition-colors">
            투어 목록
          </Link>
        </div>
      </nav>

      <main className="pt-28 md:pt-36 pb-32 max-w-[1100px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          <div>
            <div className="aspect-[4/3] bg-stone-900 overflow-hidden mb-3 relative">
              {heroImage ? (
                <img src={heroImage} alt={tour.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-700">
                  <Compass size={64} strokeWidth={1} />
                </div>
              )}
            </div>
            {tour.images.length > 1 && (
              <div className="flex gap-2 mb-6 overflow-x-auto">
                {tour.images.map((img, i) => (
                  <button
                    key={img}
                    type="button"
                    onClick={() => setHeroIndex(i)}
                    className={`flex-shrink-0 w-16 h-16 overflow-hidden border transition-colors ${
                      i === heroIndex ? 'border-white' : 'border-white/10 hover:border-white/40'
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-4">{tour.title}</h1>
            {tour.description && (
              <p className="text-stone-300 font-light leading-relaxed mb-6 whitespace-pre-line">{tour.description}</p>
            )}
            <div className="space-y-2 text-sm text-stone-400">
              {tour.maxGroupSize && <div className="flex items-center gap-2"><UsersIcon size={14} /> 최대 {tour.maxGroupSize}명</div>}
              {tour.meetingPoint && <div className="flex items-center gap-2"><MapPin size={14} /> {tour.meetingPoint}</div>}
            </div>
          </div>

          <div className="bg-stone-900/40 border border-white/[0.08] p-6 sm:p-8 lg:sticky lg:top-28 self-start">
            <h2 className="text-xs uppercase tracking-[0.25em] text-stone-400 mb-5">예약</h2>

            {/* Course / duration option selector */}
            {tour.durationOptions.length > 0 ? (
              <div className="mb-5">
                <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">코스 선택</label>
                <div className="space-y-2">
                  {tour.durationOptions.map(opt => {
                    const isSelected = selectedOptionId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedOptionId(opt.id)}
                        className={`w-full flex items-center justify-between gap-3 px-4 py-3 border text-left transition-colors ${
                          isSelected
                            ? 'bg-white text-stone-900 border-white'
                            : 'bg-transparent text-stone-100 border-white/15 hover:border-white/40'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium flex items-center gap-2">
                            <Clock size={13} /> {formatDuration(opt.durationMin)}
                            {opt.label && <span className="text-xs font-light opacity-70">· {opt.label}</span>}
                          </p>
                        </div>
                        <p className="text-sm font-medium tabular-nums">
                          {opt.price.toLocaleString()}원
                          <span className={`text-[10px] font-light ml-0.5 ${isSelected ? 'opacity-60' : 'opacity-50'}`}>/ 인</span>
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              tour.basePrice && (
                <p className="text-2xl font-light tracking-tight mb-6 text-stone-50">
                  {tour.basePrice.toLocaleString()}원
                  <span className="text-xs text-stone-500 font-light ml-1">/ 인</span>
                </p>
              )
            )}

            <div className="mb-5">
              <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">날짜 · 시간</label>
              {tour.slots.length === 0 ? (
                <p className="text-xs text-stone-500 py-3">예약 가능한 슬롯이 없습니다.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {Array.from(slotsByDate.entries()).map(([date, slots]) => (
                    <div key={date}>
                      <p className="text-[11px] text-stone-400 font-medium tracking-wide mb-1.5">
                        {format(parseISO(date), 'M월 d일 (E)', { locale: ko })}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {slots.map(s => {
                          const isSelected = selectedSlotId === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setSelectedSlotId(s.id)}
                              className={`text-xs px-3 py-1.5 border transition-colors ${
                                isSelected
                                  ? 'bg-white text-stone-900 border-white'
                                  : 'bg-transparent text-stone-200 border-white/15 hover:border-white/40'
                              }`}
                            >
                              {s.startTime}
                              <span className={`ml-1.5 text-[10px] ${isSelected ? 'text-stone-500' : 'text-stone-500'}`}>
                                ({s.remaining}석)
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tier counters or single guest input */}
            {hasTiers ? (
              <div className="mb-4">
                <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">티켓</label>
                <div className="space-y-2">
                  {tour.ticketTiers.map(t => {
                    const count = tierCounts[t.id] ?? 0;
                    return (
                      <div key={t.id} className="flex items-center gap-3 bg-stone-950/60 border border-white/10 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-stone-100">
                            {t.label}
                            {t.notes && <span className="text-[11px] text-stone-500 ml-1">{t.notes}</span>}
                          </p>
                          <p className="text-[11px] text-stone-400 tabular-nums">
                            {t.price > 0 ? `${t.price.toLocaleString()}원` : '무료'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => adjustTier(t.id, -1)}
                            disabled={count === 0}
                            className="w-7 h-7 border border-white/15 text-stone-200 hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
                          >−</button>
                          <span className="w-6 text-center text-sm text-stone-100 tabular-nums">{count}</span>
                          <button
                            type="button"
                            onClick={() => adjustTier(t.id, 1)}
                            className="w-7 h-7 border border-white/15 text-stone-200 hover:border-white/40 text-sm"
                          >+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalPrice !== null && (
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-stone-400">총 {effectiveCount}명</span>
                    <span className="text-stone-100 font-medium">{totalPrice.toLocaleString()}원</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">인원</label>
                  <input
                    type="number"
                    min="1"
                    max={selectedSlot?.remaining ?? tour.maxGroupSize ?? 99}
                    value={guests}
                    onChange={e => setGuests(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full bg-stone-950/60 border border-white/10 text-stone-100 px-3 py-2.5 text-sm focus:outline-none focus:border-white/40 transition-colors"
                  />
                </div>
                {totalPrice !== null && (
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">총 금액</label>
                    <div className="px-3 py-2.5 text-sm font-medium border border-white/10 bg-stone-950/40 text-stone-100">
                      {totalPrice.toLocaleString()}원
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Language */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">언어</label>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGE_OPTIONS.map(l => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLanguage(l.value)}
                    className={`text-xs px-3 py-1.5 border transition-colors ${
                      language === l.value
                        ? 'bg-white text-stone-900 border-white'
                        : 'bg-transparent text-stone-200 border-white/15 hover:border-white/40'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Meeting point */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">만나는 곳</label>
              <div className="space-y-2">
                {MEETING_OPTIONS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMeetingChoice(m.value)}
                    className={`w-full text-left text-sm px-3 py-2.5 border transition-colors ${
                      meetingChoice === m.value
                        ? 'bg-white text-stone-900 border-white'
                        : 'bg-transparent text-stone-200 border-white/15 hover:border-white/40'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {meetingChoice === 'accommodation' && (
                <input
                  type="text"
                  placeholder="숙소명 또는 주소"
                  value={meetingDetail}
                  onChange={e => setMeetingDetail(e.target.value)}
                  className="mt-2 w-full bg-stone-950/60 border border-white/10 text-stone-100 placeholder:text-stone-500 px-3 py-2.5 text-sm focus:outline-none focus:border-white/40 transition-colors"
                />
              )}
            </div>

            <div className="space-y-3 mb-5">
              <input type="text" placeholder="이름 *" value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-stone-950/60 border border-white/10 text-stone-100 placeholder:text-stone-500 px-4 py-3 text-sm focus:outline-none focus:border-white/40 transition-colors" />
              <input type="tel" placeholder="연락처 (선택, 010-0000-0000)" value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full bg-stone-950/60 border border-white/10 text-stone-100 placeholder:text-stone-500 px-4 py-3 text-sm focus:outline-none focus:border-white/40 transition-colors" />
              <input type="email" placeholder="이메일 (선택)" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-stone-950/60 border border-white/10 text-stone-100 placeholder:text-stone-500 px-4 py-3 text-sm focus:outline-none focus:border-white/40 transition-colors" />
              <textarea placeholder="요청사항 (선택)" value={message} onChange={e => setMessage(e.target.value)} rows={2}
                className="w-full bg-stone-950/60 border border-white/10 text-stone-100 placeholder:text-stone-500 px-4 py-3 text-sm focus:outline-none focus:border-white/40 transition-colors resize-none" />
            </div>

            {error && <p className="text-xs text-rose-400 mb-3">{error}</p>}

            <button
              onClick={submit}
              disabled={submitting || !selectedSlotId || !name}
              className="w-full bg-white hover:bg-stone-200 disabled:bg-stone-700 disabled:text-stone-500 text-stone-900 py-3.5 text-xs uppercase tracking-widest font-medium transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? '예약 중...' : <>예약하기 <ArrowRight size={13} /></>}
            </button>

            <p className="text-[10px] text-stone-500 mt-3 text-center tracking-wide">
              예약 후 운영업체 확정 시 연락드립니다
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
