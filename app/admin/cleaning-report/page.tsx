'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  format,
  subMonths,
  addMonths,
  setDate,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  isWithinInterval,
  parseISO,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  FileBarChart,
  Download,
  ChevronDown,
} from 'lucide-react';
import { SkeletonList } from '@/components/ui';

interface Cleaning {
  id: string;
  propertyId: string;
  date: string; // YYYY-MM-DD
  cleanerId: string | null;
  status: string; // pending | done
  cleaner?: { id: string; name: string } | null;
}

interface Cleaner {
  id: string;
  name: string;
  phone?: string;
}

interface Property {
  id: string;
  name: string;
}

interface CleaningDetail {
  id: string;
  date: string;
  propertyName: string;
  status: string;
}

interface CleanerStat {
  cleanerId: string;
  cleanerName: string;
  total: number;
  done: number;
  pending: number;
  properties: Record<string, number>;
  details: CleaningDetail[];
}

interface SettlementPeriod {
  start: Date;
  end: Date;
  startStr: string;
  endStr: string;
}

// Settlement period: 26th of previous month through 25th of the view month.
function getSettlementPeriod(viewDate: Date): SettlementPeriod {
  const end = setDate(viewDate, 25);
  const start = setDate(subMonths(viewDate, 1), 26);
  return {
    start,
    end,
    startStr: format(start, 'yyyy-MM-dd'),
    endStr: format(end, 'yyyy-MM-dd'),
  };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function CalendarMonth({
  monthDate,
  period,
  cleaningsByDate,
}: {
  monthDate: Date;
  period: SettlementPeriod;
  cleaningsByDate: Record<string, { done: number; pending: number }>;
}) {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const offset = getDay(monthStart);

  return (
    <div className="bg-white border border-stone-100 p-4 sm:p-5">
      <p className="text-sm font-bold text-stone-900 mb-4 tracking-tight">
        {format(monthDate, 'yyyy. M', { locale: ko })}
      </p>
      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={`text-[12px] font-medium pb-2 text-center ${
              i === 0 ? 'text-rose-400' : i === 6 ? 'text-[var(--brand)]' : 'text-stone-400'
            }`}
          >
            {d}
          </div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const inPeriod = isWithinInterval(day, { start: period.start, end: period.end });
          const dayInfo = cleaningsByDate[dateStr];
          const hasDone = !!dayInfo && dayInfo.done > 0;
          const hasPending = !!dayInfo && dayInfo.pending > 0;
          const isCutoff = isSameDay(day, period.end);
          const isStartDay = isSameDay(day, period.start);
          const dow = getDay(day);

          let cellClass = 'text-stone-300';
          if (inPeriod) {
            if (dow === 0) cellClass = 'text-rose-500';
            else if (dow === 6) cellClass = 'text-[var(--brand)]';
            else cellClass = 'text-stone-900';
          }

          return (
            <div
              key={dateStr}
              className="aspect-square flex flex-col items-center justify-center relative py-1"
            >
              <div
                className={`w-8 h-8 flex items-center justify-center text-[13px] tabular-nums transition-colors ${
                  isCutoff
                    ? 'bg-[var(--brand-dark)] text-white font-bold ring-4 ring-[var(--brand)]/15'
                    : isStartDay
                    ? 'border-2 border-[var(--brand)] text-[var(--brand-dark)] font-bold'
                    : cellClass
                }`}
              >
                {format(day, 'd')}
              </div>
              {(hasDone || hasPending) && (
                <div className="flex gap-0.5 absolute bottom-0.5">
                  {hasDone && <span className="w-1 h-1 rounded-full bg-[var(--brand)]" />}
                  {hasPending && <span className="w-1 h-1 rounded-full bg-amber-400" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CleaningReportPage() {
  const { user } = useAuth();
  const [cleanings, setCleanings] = useState<Cleaning[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(new Date());
  const [expandedCleanerId, setExpandedCleanerId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadData = async () => {
    try {
      const [propsRes, cleanersRes, cleaningsRes] = await Promise.all([
        fetch('/api/properties'),
        fetch('/api/cleaners'),
        fetch('/api/cleanings'),
      ]);

      if (propsRes.ok) setProperties(await propsRes.json());
      if (cleanersRes.ok) setCleaners(await cleanersRes.json());
      if (cleaningsRes.ok) setCleanings(await cleaningsRes.json());
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  };

  const propMap = useMemo(() => {
    const m: Record<string, string> = {};
    properties.forEach(p => { m[p.id] = p.name; });
    return m;
  }, [properties]);

  const period = useMemo(() => getSettlementPeriod(viewDate), [viewDate]);

  const periodLabel = useMemo(() => {
    const sameYear = period.start.getFullYear() === period.end.getFullYear();
    const startFmt = sameYear ? 'M월 d일' : 'yyyy년 M월 d일';
    return `${format(period.start, startFmt, { locale: ko })} ~ ${format(period.end, 'M월 d일', { locale: ko })}`;
  }, [period.start, period.end]);

  const periodDays = Math.round((period.end.getTime() - period.start.getTime()) / 86400000) + 1;

  const periodCleanings = useMemo(() => {
    return cleanings.filter(c => c.date >= period.startStr && c.date <= period.endStr);
  }, [cleanings, period.startStr, period.endStr]);

  const cleaningsByDate = useMemo(() => {
    const map: Record<string, { done: number; pending: number }> = {};
    periodCleanings.forEach(c => {
      if (!map[c.date]) map[c.date] = { done: 0, pending: 0 };
      if (c.status === 'done') map[c.date].done++;
      else map[c.date].pending++;
    });
    return map;
  }, [periodCleanings]);

  const stats = useMemo(() => {
    const map: Record<string, CleanerStat> = {};

    cleaners.forEach(c => {
      map[c.id] = {
        cleanerId: c.id,
        cleanerName: c.name,
        total: 0,
        done: 0,
        pending: 0,
        properties: {},
        details: [],
      };
    });

    periodCleanings.forEach(c => {
      if (!c.cleanerId) return;
      if (!map[c.cleanerId]) {
        map[c.cleanerId] = {
          cleanerId: c.cleanerId,
          cleanerName: c.cleaner?.name ?? '알 수 없음',
          total: 0,
          done: 0,
          pending: 0,
          properties: {},
          details: [],
        };
      }
      const stat = map[c.cleanerId];
      stat.total++;
      if (c.status === 'done') stat.done++;
      else stat.pending++;

      const propName = propMap[c.propertyId] ?? '알 수 없음';
      stat.properties[propName] = (stat.properties[propName] ?? 0) + 1;
      stat.details.push({
        id: c.id,
        date: c.date,
        propertyName: propName,
        status: c.status,
      });
    });

    Object.values(map).forEach(s => {
      s.details.sort((a, b) => a.date.localeCompare(b.date));
    });

    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [periodCleanings, cleaners, propMap]);

  const totalDone = periodCleanings.filter(c => c.status === 'done').length;
  const totalAll = periodCleanings.filter(c => c.cleanerId).length;
  const unassigned = periodCleanings.filter(c => !c.cleanerId).length;

  const periodTrend = useMemo(() => {
    const items: { label: string; key: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const ref = subMonths(viewDate, i);
      const p = getSettlementPeriod(ref);
      const count = cleanings.filter(
        c => c.date >= p.startStr && c.date <= p.endStr && c.status === 'done'
      ).length;
      items.push({
        label: format(p.end, 'M월', { locale: ko }),
        key: p.endStr,
        count,
      });
    }
    return items;
  }, [cleanings, viewDate]);

  const maxTrend = Math.max(...periodTrend.map(m => m.count), 1);

  const prevPeriod = () => setViewDate(subMonths(viewDate, 1));
  const nextPeriod = () => setViewDate(addMonths(viewDate, 1));

  const exportCSV = () => {
    const header = '담당자,완료,대기,합계,숙소별 내역,수행 날짜';
    const rows = stats
      .filter(s => s.total > 0)
      .map(s => {
        const propDetail = Object.entries(s.properties).map(([name, cnt]) => `${name}(${cnt})`).join(' / ');
        const dateList = s.details.map(d => `${d.date}(${d.propertyName})`).join(' / ');
        return `${s.cleanerName},${s.done},${s.pending},${s.total},"${propDetail}","${dateList}"`;
      });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `청소보고서_${format(period.end, 'yyyy-MM-dd')}정산.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <SkeletonList count={3} rows={2} />;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Light surface — LG Pra.L inspired */}
      <div className="bg-[#fafafa] text-stone-900 overflow-hidden shadow-2xl shadow-stone-200">
        <div className="p-5 sm:p-8 lg:p-10 space-y-8 sm:space-y-10">

          {/* Header */}
          <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-6 border-b border-stone-200/70">
            <div>
              <p className="text-[13px] uppercase tracking-[0.25em] text-[var(--brand)] mb-3 font-semibold">REPORT</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">청소 완료 보고서</h1>
              <p className="text-stone-500 mt-2 text-sm">매월 25일 마감 · 담당자별 수행 내역</p>
            </div>
            <button
              onClick={exportCSV}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold uppercase tracking-widest transition-colors active:scale-[0.98] shrink-0"
            >
              <Download size={14} />
              CSV 내보내기
            </button>
          </header>

          {/* Period selector */}
          <div className="flex items-center justify-center gap-3 sm:gap-5">
            <button
              onClick={prevPeriod}
              className="w-10 h-10 bg-white border border-stone-200 flex items-center justify-center text-stone-500 hover:text-stone-900 hover:border-stone-300 active:scale-90 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center min-w-[180px]">
              <h2 className="text-xl sm:text-2xl font-bold text-stone-900 tracking-tight">
                {format(period.end, 'yyyy년 M월', { locale: ko })} 정산
              </h2>
              <p className="text-xs text-[var(--brand)] mt-1.5 font-semibold tracking-wide">
                {periodLabel} <span className="text-stone-400 font-normal mx-1">·</span> {periodDays}일
              </p>
            </div>
            <button
              onClick={nextPeriod}
              className="w-10 h-10 bg-white border border-stone-200 flex items-center justify-center text-stone-500 hover:text-stone-900 hover:border-stone-300 active:scale-90 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Calendar — two months covering the settlement period */}
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <CalendarMonth
                monthDate={subMonths(period.end, 1)}
                period={period}
                cleaningsByDate={cleaningsByDate}
              />
              <CalendarMonth
                monthDate={period.end}
                period={period}
                cleaningsByDate={cleaningsByDate}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 px-1 text-[13px] text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--brand)]" />
                완료
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                대기
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[var(--brand-dark)] ring-2 ring-[var(--brand)]/15" />
                정산일 (25일)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-[var(--brand)]" />
                정산 시작 (26일)
              </span>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-stone-100 p-4 sm:p-5 text-center">
              <p className="text-2xl sm:text-3xl font-bold text-[var(--brand)] mb-1 tabular-nums">{totalDone}</p>
              <p className="text-[13px] sm:text-xs text-stone-500 tracking-wide">완료</p>
            </div>
            <div className="bg-white border border-stone-100 p-4 sm:p-5 text-center">
              <p className={`text-2xl sm:text-3xl font-bold mb-1 tabular-nums ${(totalAll - totalDone) > 0 ? 'text-amber-500' : 'text-stone-300'}`}>
                {totalAll - totalDone}
              </p>
              <p className="text-[13px] sm:text-xs text-stone-500 tracking-wide">대기</p>
            </div>
            <div className="bg-white border border-stone-100 p-4 sm:p-5 text-center">
              <p className={`text-2xl sm:text-3xl font-bold mb-1 tabular-nums ${unassigned > 0 ? 'text-rose-500' : 'text-stone-300'}`}>
                {unassigned}
              </p>
              <p className="text-[13px] sm:text-xs text-stone-500 tracking-wide">미배정</p>
            </div>
          </div>

          {/* Trend chart */}
          <div className="bg-white border border-stone-100 p-5 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-stone-900 tracking-tight">정산 기간별 추이</h3>
              <span className="text-[13px] text-stone-400">최근 6개 정산</span>
            </div>
            <div className="flex items-end gap-2 sm:gap-3 h-28">
              {periodTrend.map(m => {
                const height = maxTrend > 0 ? (m.count / maxTrend) * 100 : 0;
                const isCurrent = m.key === period.endStr;
                return (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-2">
                    <span className={`text-xs tabular-nums font-semibold ${isCurrent ? 'text-[var(--brand)]' : 'text-stone-400'}`}>
                      {m.count}
                    </span>
                    <div className="w-full flex justify-center">
                      <div
                        className={`w-full max-w-[34px] transition-all ${
                          isCurrent ? 'bg-[var(--brand-dark)]' : 'bg-[var(--brand-tint-strong)]'
                        }`}
                        style={{ height: `${Math.max(height, 4)}%` }}
                      />
                    </div>
                    <span className={`text-[12px] sm:text-[13px] ${isCurrent ? 'text-stone-900 font-semibold' : 'text-stone-400'}`}>
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-cleaner list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-stone-900 tracking-tight">담당자별 현황</h3>
              <span className="text-[13px] text-stone-400">담당자를 누르면 수행 날짜가 펼쳐집니다</span>
            </div>

            {stats.length === 0 ? (
              <div className="text-center py-16 bg-white border border-stone-100">
                <FileBarChart size={32} className="mx-auto mb-3 text-stone-300" />
                <p className="text-stone-400 text-sm">등록된 청소 담당자가 없습니다.</p>
              </div>
            ) : (
              <div className="bg-white border border-stone-100 overflow-hidden">
                {stats.map((stat, idx) => {
                  const isExpanded = expandedCleanerId === stat.cleanerId;
                  const isClickable = stat.total > 0;
                  const completionRate = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0;
                  const initial = stat.cleanerName.charAt(0);

                  return (
                    <div key={stat.cleanerId} className={idx > 0 ? 'border-t border-stone-100' : ''}>
                      <button
                        type="button"
                        onClick={() => isClickable && setExpandedCleanerId(isExpanded ? null : stat.cleanerId)}
                        disabled={!isClickable}
                        className={`w-full flex items-center gap-3 px-4 sm:px-5 py-4 text-left transition-colors ${
                          isClickable ? 'hover:bg-stone-50 active:bg-stone-100 cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        <div className={`w-11 h-11 flex items-center justify-center font-semibold text-sm shrink-0 ${
                          isClickable ? 'bg-[var(--brand-tint-strong)] text-[var(--brand-dark)]' : 'bg-stone-100 text-stone-400'
                        }`}>
                          {initial}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-stone-900 truncate">{stat.cleanerName}</p>
                          {stat.total > 0 ? (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="h-1 w-20 bg-stone-100 overflow-hidden">
                                <div
                                  className="h-full bg-[var(--brand)] transition-all"
                                  style={{ width: `${completionRate}%` }}
                                />
                              </div>
                              <span className="text-[13px] text-stone-500 tabular-nums">{completionRate}%</span>
                            </div>
                          ) : (
                            <p className="text-xs text-stone-400 mt-0.5">이번 정산 기간 배정 없음</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base font-bold text-[var(--brand)] tabular-nums">
                            {stat.done}
                            <span className="text-stone-300 font-normal">/{stat.total}</span>
                          </p>
                        </div>
                        {isClickable ? (
                          <ChevronDown
                            size={18}
                            className={`text-stone-300 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        ) : (
                          <div className="w-[18px] shrink-0" />
                        )}
                      </button>

                      {isExpanded && stat.details.length > 0 && (
                        <div className="bg-stone-50/70 px-4 sm:px-5 py-4 border-t border-stone-100">
                          <p className="text-[12px] tracking-[0.2em] text-[var(--brand)] mb-3 font-semibold">수행 날짜</p>
                          <ul className="space-y-1.5">
                            {stat.details.map(d => {
                              const dateObj = parseISO(d.date);
                              const dateLabel = format(dateObj, 'M월 d일 (EEE)', { locale: ko });
                              const isDone = d.status === 'done';
                              return (
                                <li
                                  key={d.id}
                                  className="flex items-center justify-between gap-3 text-sm py-2.5 px-3 bg-white border border-stone-100"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-stone-900 tabular-nums shrink-0 font-semibold">{dateLabel}</span>
                                    <span className="text-stone-500 truncate">{d.propertyName}</span>
                                  </div>
                                  <span
                                    className={`inline-flex items-center px-2 py-1 ring-1 shrink-0 text-[12px] leading-none uppercase tracking-widest ${
                                      isDone
                                        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                                        : 'bg-amber-50 text-amber-800 ring-amber-200'
                                    }`}
                                  >
                                    {isDone ? '완료' : '대기'}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
