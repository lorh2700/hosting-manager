'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  format,
  parseISO,
  addDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isToday,
  isAfter,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, Clock } from 'lucide-react';

interface CleaningRow {
  id: string;
  propertyId: string;
  propertyName: string;
  date: string;
  cleanerId: string | null;
  cleanerName: string | null;
  status: 'pending' | 'done';
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export default function CleanerCalendarPage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [cleanings, setCleanings] = useState<CleaningRow[]>([]);
  const [myCleanerId, setMyCleanerId] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !profile) return;
    (async () => {
      try {
        const propsRes = await fetch('/api/properties');
        const propsData = await propsRes.json();
        const propNames: Record<string, string> = {};
        const propertyIds: string[] = [];
        for (const p of propsData) {
          propNames[p.id] = p.name;
          propertyIds.push(p.id);
        }
        if (propertyIds.length === 0) return;

        const [meRes, cleaningsRes, cleanersRes] = await Promise.all([
          fetch('/api/cleaners/me'),
          fetch(`/api/cleanings?propertyIds=${propertyIds.join(',')}`),
          fetch('/api/cleaners'),
        ]);
        const meData = meRes.ok ? await meRes.json() : { cleaner: null };
        const cleanerId = meData?.cleaner?.id ?? null;
        setMyCleanerId(cleanerId);

        const cleaningsData = cleaningsRes.ok ? await cleaningsRes.json() : [];
        const cleanersList = cleanersRes.ok ? await cleanersRes.json() : [];
        // Build a name lookup map; cleaner names from /api/cleaners are
        // owner-scoped, so this only covers same-owner colleagues. The
        // primary source is the included `cleaner` relation on each
        // cleaning row, which crosses owner boundaries.
        const cleanersMap: Record<string, string> = {};
        for (const c of cleanersList as Array<{ id: string; name: string }>) {
          cleanersMap[c.id] = c.name;
        }

        const rows: CleaningRow[] = (Array.isArray(cleaningsData) ? cleaningsData : []).map((c: Record<string, unknown>) => {
          const cid = (c.cleanerId as string) || null;
          // Prefer the included cleaner.name (works for any owner);
          // fall back to the lookup map.
          const includedCleaner = c.cleaner as { name?: string } | null | undefined;
          const cleanerName = cid
            ? (includedCleaner?.name ?? cleanersMap[cid] ?? null)
            : null;
          return {
            id: c.id as string,
            propertyId: c.propertyId as string,
            propertyName: propNames[c.propertyId as string] ?? '알 수 없는 숙소',
            date: c.date as string,
            cleanerId: cid,
            cleanerName,
            status: ((c.status as string) === 'done' ? 'done' : 'pending') as 'done' | 'pending',
          };
        });
        setCleanings(rows);
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const calendarDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 1 });
    const days: Date[] = [];
    for (let d = gridStart; !isAfter(d, gridEnd); d = addDays(d, 1)) days.push(d);
    return days;
  }, [monthCursor]);

  const cleaningsByDate = useMemo(() => {
    const map = new Map<string, CleaningRow[]>();
    for (const c of cleanings) {
      const list = map.get(c.date) ?? [];
      list.push(c);
      map.set(c.date, list);
    }
    return map;
  }, [cleanings]);

  const selected = selectedDate ? cleaningsByDate.get(selectedDate) ?? [] : [];

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-stone-200 border-t-[var(--brand)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-stone-200 pb-6 sm:pb-7">
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">청소 담당자</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">캘린더</h1>
        <p className="text-stone-500 mt-2 text-sm">월별 청소 일정을 한눈에 확인할 수 있습니다.</p>
      </header>

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setMonthCursor(subMonths(monthCursor, 1))}
          className="p-2 border border-stone-200 hover:border-stone-300 transition-colors"
          aria-label="이전 달"
        >
          <ChevronLeft size={14} />
        </button>
        <h2 className="text-base font-medium tracking-wide text-stone-900">
          {format(monthCursor, 'yyyy년 M월', { locale: ko })}
        </h2>
        <button
          onClick={() => setMonthCursor(addMonths(monthCursor, 1))}
          className="p-2 border border-stone-200 hover:border-stone-300 transition-colors"
          aria-label="다음 달"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Calendar */}
      <div className="bg-white border border-stone-200">
        <div className="grid grid-cols-7 text-[10px] uppercase tracking-widest text-stone-500 border-b border-stone-200">
          {WEEKDAYS.map(d => (
            <div key={d} className={`px-2 py-3 text-center ${d === '토' ? 'text-sky-600' : d === '일' ? 'text-rose-600' : ''}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calendarDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayCleanings = cleaningsByDate.get(dateStr) ?? [];
            // Sort: mine first, then other-assigned, then unassigned
            const sorted = [...dayCleanings].sort((a, b) => {
              const aMine = myCleanerId && a.cleanerId === myCleanerId ? 0 : 2;
              const bMine = myCleanerId && b.cleanerId === myCleanerId ? 0 : 2;
              const aOpen = !a.cleanerId ? 1 : 0;
              const bOpen = !b.cleanerId ? 1 : 0;
              return (aMine + aOpen) - (bMine + bOpen);
            });
            const MAX_VISIBLE = 3;
            const visible = sorted.slice(0, MAX_VISIBLE);
            const hidden = sorted.length - visible.length;
            const inMonth = isSameMonth(day, monthCursor);
            const isSel = selectedDate === dateStr;
            const today = isToday(day);
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => setSelectedDate(dateStr)}
                className={`relative min-h-[88px] border-r border-b border-stone-100 p-1.5 text-left transition-colors ${
                  isSel ? 'bg-[var(--brand-tint)] ring-2 ring-[var(--brand)]/30' : 'hover:bg-stone-50'
                } ${!inMonth ? 'opacity-40' : ''}`}
              >
                <div className={`text-xs mb-1 ${today ? 'text-[var(--brand)] font-semibold' : 'text-stone-700'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5">
                  {visible.map(c => {
                    const isMine = !!myCleanerId && c.cleanerId === myCleanerId;
                    const isOpen = !c.cleanerId;
                    const cls = isMine
                      ? 'bg-[var(--brand)] text-white'
                      : isOpen
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-stone-200 text-stone-700';
                    const label = isMine
                      ? `${c.cleanerName ?? '나'} (나)`
                      : isOpen
                        ? '미배정'
                        : (c.cleanerName ?? '담당자');
                    return (
                      <div key={c.id} className={`text-[10px] ${cls} px-1.5 py-0.5 truncate tracking-wide`} title={`${c.propertyName} · ${label}`}>
                        {label}
                      </div>
                    );
                  })}
                  {hidden > 0 && (
                    <div className="text-[10px] text-stone-500 px-1.5 truncate">
                      +{hidden}건
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="bg-white border border-stone-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-stone-900">
              {format(parseISO(selectedDate), 'M월 d일 (EEE)', { locale: ko })}
            </h3>
            <button onClick={() => setSelectedDate(null)} className="text-xs text-stone-500 hover:text-stone-900">
              닫기
            </button>
          </div>
          {selected.length === 0 ? (
            <div className="flex flex-col items-center text-stone-400 py-6">
              <CalendarDays size={20} className="mb-2 opacity-50" />
              <p className="text-xs">이 날짜에 청소 일정이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selected.map(c => {
                const isMine = myCleanerId && c.cleanerId === myCleanerId;
                const isOpen = !c.cleanerId;
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 p-3 border ${
                      isMine ? 'border-[var(--brand)]/30 bg-[var(--brand-tint)]' : 'border-stone-200 bg-stone-50'
                    }`}
                  >
                    {c.status === 'done' ? (
                      <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    ) : (
                      <Clock size={16} className="text-stone-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-stone-900 font-medium">{c.propertyName}</p>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        {isMine
                          ? <span className="text-[var(--brand-dark)] font-medium">내가 배정됨</span>
                          : isOpen
                            ? <span className="text-amber-700">미배정</span>
                            : <span>{c.cleanerName ?? '다른 담당자'} 배정</span>}
                        {c.status === 'done' && ' · 완료'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
