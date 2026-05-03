'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  format,
  parseISO,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isToday,
  isBefore,
  isAfter,
  isSameDay,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarDays, Hand, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';

interface OpenCleaning {
  id: string;
  propertyId: string;
  propertyName: string;
  date: string;
  supplies?: string;
  notes?: string;
  isOpen: boolean;
  cleanerId?: string;
  status: 'pending' | 'done';
}

interface MyApplication {
  id: string;
  cleaningId: string;
  propertyName: string;
  date: string;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string;
  createdAt: string;
}

const FORWARD_DAYS = 28;

export default function CleanerSchedulePage() {
  const { user, profile } = useAuth();
  const [openCleanings, setOpenCleanings] = useState<OpenCleaning[]>([]);
  const [myApplications, setMyApplications] = useState<MyApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyNote, setApplyNote] = useState('');
  const [showApplyForm, setShowApplyForm] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadData = async () => {
    if (!user || !profile) return;
    setLoading(true);
    try {
      const propsRes = await fetch('/api/properties');
      const propsData = await propsRes.json();
      const propNames: Record<string, string> = {};
      const propertyIds: string[] = [];
      for (const p of propsData) {
        propNames[p.id] = p.name;
        propertyIds.push(p.id);
      }
      if (propertyIds.length === 0) { setLoading(false); return; }

      const cleaningsRes = await fetch(`/api/cleanings?propertyIds=${propertyIds.join(',')}&isOpen=true`);
      const cleaningsData = await cleaningsRes.json();

      const today = format(new Date(), 'yyyy-MM-dd');
      const cutoff = format(addDays(new Date(), FORWARD_DAYS), 'yyyy-MM-dd');

      const opens: OpenCleaning[] = cleaningsData.map((c: Record<string, unknown>) => ({
        id: c.id as string,
        propertyId: c.propertyId as string,
        propertyName: propNames[c.propertyId as string] ?? '알 수 없는 숙소',
        date: c.date as string,
        supplies: c.supplies as string | undefined,
        notes: c.notes as string | undefined,
        isOpen: c.isOpen as boolean,
        cleanerId: c.cleanerId as string | undefined,
        status: c.status as 'pending' | 'done',
      }))
        // Defensive: hide rows that are already assigned to someone else
        // even if the API mistakenly returned them.
        .filter((c: OpenCleaning) => !c.cleanerId)
        .filter((c: OpenCleaning) => c.date >= today && c.date <= cutoff)
        .sort((a: OpenCleaning, b: OpenCleaning) => a.date.localeCompare(b.date));

      setOpenCleanings(opens);

      const appsRes = await fetch(`/api/cleaning-applications`);
      const appsData = await appsRes.json();

      const apps: MyApplication[] = appsData.map((a: Record<string, unknown>) => {
        const cleaning = cleaningsData.find((c: Record<string, unknown>) => c.id === a.cleaningId);
        return {
          id: a.id as string,
          cleaningId: a.cleaningId as string,
          propertyName: cleaning ? propNames[cleaning.propertyId as string] ?? '알 수 없는 숙소' : '',
          date: cleaning ? (cleaning.date as string) : '',
          note: a.note as string | undefined,
          status: a.status as 'pending' | 'approved' | 'rejected',
          rejectedReason: a.rejectedReason as string | undefined,
          createdAt: a.createdAt as string,
        };
      }).sort((a: MyApplication, b: MyApplication) => b.createdAt.localeCompare(a.createdAt));

      setMyApplications(apps);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (cleaning: OpenCleaning) => {
    if (!user || !profile) return;
    setApplying(cleaning.id);
    try {
      const res = await fetch('/api/cleaning-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaningId: cleaning.id,
          propertyId: cleaning.propertyId,
          applicantId: user.id,
          applicantName: profile.displayName || user.email || 'unknown',
          note: applyNote.trim() || null,
          status: 'pending',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to apply');
      }

      setShowApplyForm(null);
      setApplyNote('');
      alert('배정이 완료되었습니다.');
      await loadData();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '신청에 실패했습니다.');
    } finally {
      setApplying(null);
    }
  };

  const today = new Date();
  const windowStart = today;
  const windowEnd = addDays(today, FORWARD_DAYS);

  const cleaningsByDate = useMemo(() => {
    const map = new Map<string, OpenCleaning[]>();
    for (const c of openCleanings) {
      if (!map.has(c.date)) map.set(c.date, []);
      map.get(c.date)!.push(c);
    }
    return map;
  }, [openCleanings]);

  const applicationsByCleaningId = useMemo(() => {
    const map = new Map<string, MyApplication>();
    for (const a of myApplications) {
      // Prefer the most recent non-rejected record
      const existing = map.get(a.cleaningId);
      if (!existing || (existing.status === 'rejected' && a.status !== 'rejected')) {
        map.set(a.cleaningId, a);
      }
    }
    return map;
  }, [myApplications]);

  const calendarDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 1 });
    const days: Date[] = [];
    for (let d = gridStart; !isAfter(d, gridEnd); d = addDays(d, 1)) {
      days.push(d);
    }
    return days;
  }, [monthCursor]);

  const selectedCleanings = selectedDate ? cleaningsByDate.get(selectedDate) ?? [] : [];

  const hasApplied = (cleaningId: string) => {
    const app = applicationsByCleaningId.get(cleaningId);
    return app && app.status !== 'rejected';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 tracking-wider">대기</span>;
      case 'approved': return <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 tracking-wider">승인</span>;
      case 'rejected': return <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 tracking-wider">거절</span>;
      default: return null;
    }
  };

  const canGoPrev = isAfter(startOfMonth(monthCursor), startOfMonth(today));
  const canGoNext = isBefore(startOfMonth(monthCursor), startOfMonth(windowEnd));

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="border-b border-white/10 pb-6 mt-4">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">일정 관리</p>
        <h1 className="text-2xl font-light tracking-tight text-white">청소 일정 신청</h1>
        <p className="text-white/40 text-xs mt-2 tracking-wide">
          앞으로 4주 이내의 미배정 청소를 신청할 수 있습니다.
        </p>
      </header>

      {/* Month calendar */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => canGoPrev && setMonthCursor(addMonths(monthCursor, -1))}
            disabled={!canGoPrev}
            className="text-white/40 hover:text-white p-2 disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label="이전 달"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-white text-lg font-light tracking-widest">
            {format(monthCursor, 'yyyy년 M월', { locale: ko })}
          </h2>
          <button
            onClick={() => canGoNext && setMonthCursor(addMonths(monthCursor, 1))}
            disabled={!canGoNext}
            className="text-white/40 hover:text-white p-2 disabled:opacity-20 disabled:cursor-not-allowed"
            aria-label="다음 달"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px bg-white/5 border border-white/10">
          {['월', '화', '수', '목', '금', '토', '일'].map(d => (
            <div key={d} className="bg-[#0a0a0a] text-center py-2 text-[10px] uppercase tracking-widest text-white/40">
              {d}
            </div>
          ))}
          {calendarDays.map(d => {
            const dateStr = format(d, 'yyyy-MM-dd');
            const dayCleanings = cleaningsByDate.get(dateStr) ?? [];
            const inWindow = !isBefore(d, startOfMonth(windowStart)) &&
                             !isAfter(d, windowEnd) &&
                             !isBefore(d, new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate()));
            const inCurrentMonth = isSameMonth(d, monthCursor);
            const isSelected = selectedDate === dateStr;
            const todayCell = isToday(d);
            const hasOpen = dayCleanings.length > 0;
            const myAppOnDay = dayCleanings.some(c => hasApplied(c.id));

            return (
              <button
                key={dateStr}
                onClick={() => hasOpen && setSelectedDate(isSelected ? null : dateStr)}
                disabled={!hasOpen}
                className={`bg-[#0f0f0f] min-h-[72px] p-2 flex flex-col items-start text-left transition-colors ${
                  hasOpen ? 'hover:bg-[#1a1a1a] cursor-pointer' : 'cursor-default'
                } ${isSelected ? 'ring-1 ring-white/60 bg-[#1a1a1a]' : ''} ${
                  !inCurrentMonth ? 'opacity-30' : ''
                } ${!inWindow && inCurrentMonth ? 'opacity-50' : ''}`}
              >
                <div className={`text-xs ${todayCell ? 'text-white font-semibold' : 'text-white/60'} ${
                  isSameDay(d, today) ? 'bg-white/10 px-1.5 rounded-sm' : ''
                }`}>
                  {format(d, 'd')}
                </div>
                {hasOpen && (
                  <div className="mt-auto w-full space-y-0.5">
                    {dayCleanings.slice(0, 2).map(c => (
                      <div
                        key={c.id}
                        className={`text-[9px] truncate px-1 py-0.5 tracking-wide ${
                          hasApplied(c.id)
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-white/10 text-white/70'
                        }`}
                      >
                        {c.propertyName}
                      </div>
                    ))}
                    {dayCleanings.length > 2 && (
                      <div className="text-[9px] text-white/40 px-1">+{dayCleanings.length - 2}</div>
                    )}
                    {myAppOnDay && dayCleanings.length <= 2 && (
                      <div className="text-[9px] text-green-400/60 px-1 flex items-center gap-0.5">
                        <CheckCircle2 size={8} />
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 text-[10px] text-white/40 tracking-wider">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-white/10 inline-block" /> 신청 가능
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-green-500/20 inline-block" /> 신청함
          </div>
        </div>
      </section>

      {/* Selected day detail */}
      {selectedDate && (
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-widest text-white/40">
            {format(parseISO(selectedDate), 'M월 d일 (EEE)', { locale: ko })} 신청 가능한 일정 ({selectedCleanings.length})
          </h2>
          {selectedCleanings.length === 0 ? (
            <div className="flex flex-col items-center text-white/40 py-8">
              <CalendarDays size={24} className="mb-2 opacity-50" />
              <p className="text-xs">이 날짜에 신청 가능한 일정이 없습니다.</p>
            </div>
          ) : (
            selectedCleanings.map(c => (
              <div key={c.id} className="border border-white/10 bg-[#111] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">{c.propertyName}</p>
                    <p className="text-white/40 text-xs mt-1">
                      {format(parseISO(c.date), 'M월 d일 (EEE)', { locale: ko })}
                    </p>
                    {c.notes && <p className="text-white/30 text-xs mt-1">{c.notes}</p>}
                  </div>
                  <div>
                    {hasApplied(c.id) ? (
                      <span className="text-[10px] text-green-400 tracking-wider flex items-center gap-1">
                        <CheckCircle2 size={12} /> 배정됨
                      </span>
                    ) : (
                      <button
                        onClick={() => handleApply(c)}
                        disabled={applying === c.id}
                        className="border border-white/20 text-white px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-white/5 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {applying === c.id ? (
                          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Hand size={12} />
                        )}
                        {applying === c.id ? '배정 중...' : '맡기'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* Upcoming list */}
      {!selectedDate && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[10px] uppercase tracking-widest text-white/40">신청 가능한 일정 ({openCleanings.length})</h2>
            <p className="text-[10px] text-white/30 tracking-wider">앞으로 4주</p>
          </div>
          {openCleanings.length === 0 ? (
            <div className="flex flex-col items-center text-white/40 py-12">
              <CalendarDays size={28} className="mb-3 opacity-50" />
              <p className="text-sm">앞으로 4주간 신청 가능한 일정이 없습니다.</p>
            </div>
          ) : (
            openCleanings.map(c => (
              <div key={c.id} className="border border-white/10 bg-[#111] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">{c.propertyName}</p>
                    <p className="text-white/40 text-xs mt-1">
                      {format(parseISO(c.date), 'M월 d일 (EEE)', { locale: ko })}
                    </p>
                    {c.notes && <p className="text-white/30 text-xs mt-1">{c.notes}</p>}
                  </div>
                  <div>
                    {hasApplied(c.id) ? (
                      <span className="text-[10px] text-green-400 tracking-wider flex items-center gap-1">
                        <CheckCircle2 size={12} /> 배정됨
                      </span>
                    ) : (
                      <button
                        onClick={() => handleApply(c)}
                        disabled={applying === c.id}
                        className="border border-white/20 text-white px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-white/5 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {applying === c.id ? (
                          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Hand size={12} />
                        )}
                        {applying === c.id ? '배정 중...' : '맡기'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* My applications */}
      {myApplications.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-widest text-white/40">내 신청 내역 ({myApplications.length})</h2>
          {myApplications.map(app => (
            <div key={app.id} className={`border p-4 ${
              app.status === 'approved' ? 'border-green-500/20 bg-green-500/5' :
              app.status === 'rejected' ? 'border-red-500/20 bg-red-500/5' :
              'border-white/10 bg-[#111]'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">{app.propertyName}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {app.date && format(parseISO(app.date), 'M월 d일 (EEE)', { locale: ko })}
                  </p>
                  {app.note && <p className="text-white/30 text-xs mt-1">메모: {app.note}</p>}
                  {app.rejectedReason && <p className="text-red-400/60 text-xs mt-1">사유: {app.rejectedReason}</p>}
                </div>
                {getStatusBadge(app.status)}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
