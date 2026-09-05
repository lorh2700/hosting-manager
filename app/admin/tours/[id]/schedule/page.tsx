'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateSelectArg, EventClickArg } from '@fullcalendar/core';
import { ChevronLeft, Plus, Loader2, Trash2, X, CalendarDays, Users, Clock } from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { toast, confirmDialog } from '@/components/ui';

interface Schedule {
  id: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:mm
  capacity: number;
  bookedCount: number;
  status: string;
  note: string | null;
}

interface BookingInSlot {
  id: string;
  name: string;
  phone: string;
  guests: number;
  status: string;
  durationMin: number | null;
  durationOption: { id: string; label: string | null; durationMin: number } | null;
}

interface DurationOption {
  id: string;
  label: string | null;
  durationMin: number;
  price: number;
}

interface TourSummary {
  id: string;
  title: string;
  maxGroupSize: number | null;
  durationOptions: DurationOption[];
}

function defaultDurationFor(tour: TourSummary | null): number {
  if (!tour) return 60;
  if (tour.durationOptions.length > 0) return tour.durationOptions[0].durationMin;
  return 60;
}

export default function TourSchedulePage() {
  const { id } = useParams() as { id: string };
  const calendarRef = useRef<FullCalendar | null>(null);
  const [tour, setTour] = useState<TourSummary | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Schedule | null>(null);
  const [slotBookings, setSlotBookings] = useState<BookingInSlot[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // for "create slot" modal triggered by empty-time click
  const [createDraft, setCreateDraft] = useState<{ date: string; startTime: string } | null>(null);
  const [draftCapacity, setDraftCapacity] = useState('');

  const fetchAll = async () => {
    try {
      const [tourRes, schedRes] = await Promise.all([
        fetch(`/api/tours/${id}`),
        fetch(`/api/tours/${id}/schedule`),
      ]);
      if (tourRes.ok) {
        const t = await tourRes.json();
        setTour({
          id: t.id,
          title: t.title,
          maxGroupSize: t.maxGroupSize,
          durationOptions: t.durationOptions ?? [],
        });
      }
      if (schedRes.ok) setSchedules(await schedRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [id]);

  const events = useMemo(() => {
    if (!tour) return [];
    const defaultDuration = defaultDurationFor(tour);
    return schedules.map(s => {
      const startISO = `${s.date}T${s.startTime}:00`;
      const startMs = new Date(startISO).getTime();
      const endMs = startMs + defaultDuration * 60 * 1000;
      const endISO = new Date(endMs).toISOString().replace('Z', '');
      const remaining = s.capacity - s.bookedCount;
      const isClosed = s.status !== 'open';
      const isFull = remaining <= 0;
      const color = isClosed
        ? '#a8a29e'                       // stone-400
        : isFull
        ? '#dc2626'                        // red-600
        : s.bookedCount > 0
        ? 'var(--brand)'
        : '#0ea5e9';                       // sky-500 (open + empty)
      return {
        id: s.id,
        title: `${s.startTime} · ${s.bookedCount}/${s.capacity}명${isClosed ? ' [마감]' : ''}`,
        start: startISO,
        end: endISO,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { schedule: s },
      };
    });
  }, [schedules, tour]);

  const openSlot = async (slot: Schedule) => {
    setSelectedSlot(slot);
    setLoadingBookings(true);
    try {
      const res = await fetch(`/api/tour-bookings?tourId=${id}`);
      if (res.ok) {
        const all = await res.json();
        // filter to this slot's bookings
        const filtered = all
          .filter((b: { scheduleId?: string; schedule?: { date: string; startTime: string } }) =>
            b.schedule?.date === slot.date && b.schedule?.startTime === slot.startTime,
          );
        setSlotBookings(filtered);
      }
    } finally {
      setLoadingBookings(false);
    }
  };

  const handleEventClick = (arg: EventClickArg) => {
    const slot = arg.event.extendedProps.schedule as Schedule | undefined;
    if (slot) openSlot(slot);
  };

  const handleSelect = (arg: DateSelectArg) => {
    const date = format(arg.start, 'yyyy-MM-dd');
    const startTime = format(arg.start, 'HH:mm');
    setCreateDraft({ date, startTime });
    setDraftCapacity(String(tour?.maxGroupSize ?? 1));
    arg.view.calendar.unselect();
  };

  const handleCreateSlot = async () => {
    if (!createDraft) return;
    const cap = Number(draftCapacity) || tour?.maxGroupSize || 1;
    const res = await fetch(`/api/tours/${id}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slots: [{ date: createDraft.date, startTime: createDraft.startTime, capacity: Math.max(1, cap) }],
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || '슬롯 추가에 실패했습니다.');
      return;
    }
    setCreateDraft(null);
    await fetchAll();
  };

  const handleDeleteSlot = async () => {
    if (!selectedSlot) return;
    if (!(await confirmDialog('이 슬롯을 삭제하시겠습니까?'))) return;
    const res = await fetch(`/api/tours/${id}/schedule?scheduleId=${selectedSlot.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || '삭제에 실패했습니다.');
      return;
    }
    setSchedules(prev => prev.filter(s => s.id !== selectedSlot.id));
    setSelectedSlot(null);
  };

  const handleToggleStatus = async () => {
    if (!selectedSlot) return;
    const next = selectedSlot.status === 'open' ? 'closed' : 'open';
    const res = await fetch(`/api/tours/${id}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: selectedSlot.id, status: next }),
    });
    if (!res.ok) return;
    setSchedules(prev => prev.map(s => s.id === selectedSlot.id ? { ...s, status: next } : s));
    setSelectedSlot(prev => prev ? { ...prev, status: next } : prev);
  };

  const handleUpdateCapacity = async (newCap: number) => {
    if (!selectedSlot) return;
    const res = await fetch(`/api/tours/${id}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: selectedSlot.id, capacity: newCap }),
    });
    if (!res.ok) return;
    setSchedules(prev => prev.map(s => s.id === selectedSlot.id ? { ...s, capacity: newCap } : s));
    setSelectedSlot(prev => prev ? { ...prev, capacity: newCap } : prev);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={20} className="animate-spin text-[var(--brand)]" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Link href={`/admin/tours/${id}`} className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-stone-500 hover:text-stone-900 transition-colors">
        <ChevronLeft size={14} /> 투어 상세
      </Link>

      <header className="border-b border-stone-200 pb-6 sm:pb-7 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[13px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">일정 · 재고 관리</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">{tour?.title}</h1>
          <p className="text-stone-500 mt-2 text-sm">
            빈 시간을 드래그/클릭해서 슬롯을 만들고, 슬롯을 클릭하면 예약 명단을 확인할 수 있습니다.
          </p>
        </div>
        <button
          onClick={() => setBulkOpen(true)}
          className="text-xs uppercase tracking-widest font-semibold text-stone-700 hover:text-stone-900 border border-stone-200 hover:border-stone-300 px-5 py-2.5 inline-flex items-center gap-2 transition-colors self-start sm:self-auto"
        >
          <CalendarDays size={13} /> 일괄 등록
        </button>
      </header>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[13px] text-stone-500">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3" style={{ backgroundColor: '#0ea5e9' }} /> 오픈 (예약 없음)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3" style={{ backgroundColor: 'var(--brand)' }} /> 예약 있음</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3" style={{ backgroundColor: '#dc2626' }} /> 만석</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3" style={{ backgroundColor: '#a8a29e' }} /> 마감</span>
      </div>

      <div className="bg-white border border-stone-200 p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay,dayGridMonth',
          }}
          buttonText={{ today: '오늘', week: '주간', day: '일간', month: '월간' }}
          locale="ko"
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="23:00:00"
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          height="auto"
          selectable
          selectMirror
          select={handleSelect}
          events={events}
          eventClick={handleEventClick}
          nowIndicator
          firstDay={1}
        />
      </div>

      {/* Slot detail panel */}
      {selectedSlot && (
        <div
          className="fixed inset-0 bg-stone-950/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelectedSlot(null)}
        >
          <div
            className="bg-white border border-stone-200 w-full sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 sm:px-6 py-5 border-b border-stone-200 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-stone-500 mb-1">{format(parseISO(selectedSlot.date), 'yyyy년 M월 d일 (E)', { locale: ko })}</p>
                <p className="text-lg font-semibold text-stone-900 flex items-center gap-2">
                  <Clock size={16} className="text-stone-500" />
                  {selectedSlot.startTime}
                </p>
                <p className="text-xs text-stone-500 mt-2">
                  {selectedSlot.bookedCount} / {selectedSlot.capacity}명
                  · 상태 <span className={selectedSlot.status === 'open' ? 'text-emerald-700' : 'text-stone-500'}>
                    {selectedSlot.status === 'open' ? '오픈' : '마감'}
                  </span>
                </p>
              </div>
              <button onClick={() => setSelectedSlot(null)} className="text-stone-400 hover:text-stone-700 transition-colors p-1">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 bg-stone-50 space-y-4">
              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">정원</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={Math.max(1, selectedSlot.bookedCount)}
                    value={selectedSlot.capacity}
                    onChange={e => setSelectedSlot({ ...selectedSlot, capacity: Number(e.target.value) || 1 })}
                    className="w-24 bg-white border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[var(--brand)]"
                  />
                  <button
                    onClick={() => handleUpdateCapacity(selectedSlot.capacity)}
                    className="text-[12px] uppercase tracking-widest px-3 py-2 bg-stone-100 hover:bg-[var(--brand)] hover:text-white text-stone-700 transition-colors"
                  >
                    저장
                  </button>
                  <p className="text-[12px] text-stone-400">현재 {selectedSlot.bookedCount}명 예약 — 그 이하로는 줄일 수 없습니다</p>
                </div>
              </div>

              <div>
                <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">예약 명단</label>
                {loadingBookings ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={16} className="animate-spin text-stone-400" />
                  </div>
                ) : slotBookings.length === 0 ? (
                  <p className="text-xs text-stone-400 py-3">아직 예약이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {slotBookings.map(b => (
                      <div key={b.id} className="bg-white border border-stone-200 p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-900">{b.name}</p>
                          <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-2">
                            <Users size={11} /> {b.guests}명
                            {b.durationMin && <><span className="text-stone-300">·</span><span>{b.durationMin}분 코스</span></>}
                            <span className="text-stone-300">·</span>
                            <a href={`tel:${b.phone}`} className="hover:text-stone-900">{b.phone}</a>
                          </p>
                        </div>
                        <span className="text-[12px] uppercase tracking-widest text-stone-500">{b.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 sm:px-6 py-3 border-t border-stone-200 flex items-center gap-2">
              <button
                onClick={handleToggleStatus}
                className={`flex-1 text-xs uppercase tracking-widest px-3 py-2 border transition-colors ${
                  selectedSlot.status === 'open'
                    ? 'border-stone-300 text-stone-700 hover:bg-stone-50'
                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                {selectedSlot.status === 'open' ? '마감 처리' : '다시 오픈'}
              </button>
              <button
                onClick={handleDeleteSlot}
                disabled={selectedSlot.bookedCount > 0}
                className="text-xs uppercase tracking-widest px-3 py-2 text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                title={selectedSlot.bookedCount > 0 ? '예약이 있어 삭제 불가' : '슬롯 삭제'}
              >
                <Trash2 size={12} /> 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick-create modal (drag/click empty) */}
      {createDraft && (
        <div
          className="fixed inset-0 bg-stone-950/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setCreateDraft(null)}
        >
          <div
            className="bg-white border border-stone-200 w-full sm:max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-stone-200">
              <p className="text-base font-semibold text-stone-900">슬롯 추가</p>
              <p className="text-xs text-stone-500 mt-0.5">
                {format(parseISO(createDraft.date), 'M월 d일 (E)', { locale: ko })} · {createDraft.startTime}
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">정원</label>
              <input
                type="number"
                min="1"
                value={draftCapacity}
                onChange={e => setDraftCapacity(e.target.value)}
                placeholder={String(tour?.maxGroupSize ?? 1)}
                className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--brand)]"
                autoFocus
              />
              {tour && tour.durationOptions.length > 0 && (
                <p className="text-[13px] text-stone-500 mt-2">
                  코스 옵션: {tour.durationOptions.map(o => `${o.durationMin}분`).join(' · ')} · 손님이 슬롯 시간에 코스를 선택합니다
                </p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-stone-200 flex justify-end gap-2">
              <button
                onClick={() => setCreateDraft(null)}
                className="text-xs uppercase tracking-widest px-4 py-2 text-stone-600 hover:text-stone-900 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreateSlot}
                className="text-xs uppercase tracking-widest px-4 py-2 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white transition-colors inline-flex items-center gap-1.5"
              >
                <Plus size={12} /> 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <BulkAddModal
          tourId={id}
          defaultCapacity={tour?.maxGroupSize ?? 1}
          onClose={() => setBulkOpen(false)}
          onDone={async () => { setBulkOpen(false); await fetchAll(); }}
        />
      )}
    </div>
  );
}

function BulkAddModal({
  tourId, defaultCapacity, onClose, onDone,
}: {
  tourId: string;
  defaultCapacity: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [times, setTimes] = useState<string[]>(['10:00']);
  const [capacity, setCapacity] = useState(String(defaultCapacity || 1));
  const [submitting, setSubmitting] = useState(false);

  const toggleWeekday = (d: number) => {
    setWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const updateTime = (i: number, value: string) => {
    setTimes(prev => prev.map((t, idx) => idx === i ? value : t));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const start = parseISO(from);
      const end = parseISO(to);
      if (end < start) {
        toast.info('종료일이 시작일보다 빠릅니다.');
        return;
      }
      const slots: { date: string; startTime: string; capacity: number }[] = [];
      const cap = Math.max(1, Number(capacity) || 1);
      for (let d = start; d <= end; d = addDays(d, 1)) {
        if (!weekdays.includes(d.getDay())) continue;
        const dateStr = format(d, 'yyyy-MM-dd');
        times.filter(t => t).forEach(t => slots.push({ date: dateStr, startTime: t, capacity: cap }));
      }
      if (slots.length === 0) {
        toast.error('생성할 슬롯이 없습니다.');
        return;
      }
      const res = await fetch(`/api/tours/${tourId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '실패');
        return;
      }
      toast.success(`${data.created}개의 슬롯이 추가되었습니다.`);
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-950/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm">
      <div className="bg-white border border-stone-200 p-6 sm:p-8 w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">슬롯 일괄 등록</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">시작일</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">종료일</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">요일</label>
            <div className="flex gap-1.5">
              {['일', '월', '화', '수', '목', '금', '토'].map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleWeekday(idx)}
                  className={`w-9 h-9 text-xs border transition-colors ${
                    weekdays.includes(idx)
                      ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                      : 'bg-white text-stone-700 border-stone-200 hover:border-stone-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">시간</label>
            <div className="space-y-2">
              {times.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="time"
                    value={t}
                    onChange={e => updateTime(i, e.target.value)}
                    className="flex-1 bg-white border border-stone-200 px-3 py-2 text-sm"
                  />
                  {times.length > 1 && (
                    <button
                      onClick={() => setTimes(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-2 text-stone-400 hover:text-red-600 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setTimes(prev => [...prev, '14:00'])}
                className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
              >
                <Plus size={12} /> 시간 추가
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] uppercase tracking-widest text-stone-500 mb-2">슬롯별 정원</label>
            <input
              type="number"
              value={capacity}
              onChange={e => setCapacity(e.target.value)}
              className="w-full bg-white border border-stone-200 px-3 py-2.5 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-stone-200">
          <button onClick={onClose} className="px-5 py-2.5 text-stone-700 hover:text-stone-900 text-sm font-medium transition-colors">
            취소
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-5 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {submitting ? '생성 중...' : '슬롯 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
