'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, FileBarChart, Download } from 'lucide-react';

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

interface CleanerStat {
  cleanerId: string;
  cleanerName: string;
  total: number;
  done: number;
  pending: number;
  properties: Record<string, number>; // propertyName -> count
}

export default function CleaningReportPage() {
  const { user } = useAuth();
  const [cleanings, setCleanings] = useState<Cleaning[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(new Date());

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

  // Filter cleanings by selected month
  const monthStr = format(viewDate, 'yyyy-MM');
  const monthCleanings = useMemo(() => {
    return cleanings.filter(c => c.date.startsWith(monthStr));
  }, [cleanings, monthStr]);

  // Build per-cleaner stats
  const stats = useMemo(() => {
    const map: Record<string, CleanerStat> = {};

    // Initialize all known cleaners
    cleaners.forEach(c => {
      map[c.id] = {
        cleanerId: c.id,
        cleanerName: c.name,
        total: 0,
        done: 0,
        pending: 0,
        properties: {},
      };
    });

    monthCleanings.forEach(c => {
      if (!c.cleanerId) return;
      if (!map[c.cleanerId]) {
        map[c.cleanerId] = {
          cleanerId: c.cleanerId,
          cleanerName: c.cleaner?.name ?? '알 수 없음',
          total: 0,
          done: 0,
          pending: 0,
          properties: {},
        };
      }
      const stat = map[c.cleanerId];
      stat.total++;
      if (c.status === 'done') stat.done++;
      else stat.pending++;

      const propName = propMap[c.propertyId] ?? '알 수 없음';
      stat.properties[propName] = (stat.properties[propName] ?? 0) + 1;
    });

    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [monthCleanings, cleaners, propMap]);

  // Totals
  const totalDone = monthCleanings.filter(c => c.status === 'done').length;
  const totalAll = monthCleanings.filter(c => c.cleanerId).length;
  const unassigned = monthCleanings.filter(c => !c.cleanerId).length;

  // Monthly trend: last 6 months
  const monthlyTrend = useMemo(() => {
    const months: { label: string; month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(viewDate, i);
      const m = format(d, 'yyyy-MM');
      const count = cleanings.filter(c => c.date.startsWith(m) && c.status === 'done').length;
      months.push({ label: format(d, 'M월', { locale: ko }), month: m, count });
    }
    return months;
  }, [cleanings, viewDate]);

  const maxTrend = Math.max(...monthlyTrend.map(m => m.count), 1);

  const prevMonth = () => setViewDate(subMonths(viewDate, 1));
  const nextMonth = () => setViewDate(addMonths(viewDate, 1));

  // CSV export
  const exportCSV = () => {
    const header = '담당자,완료,대기,합계,숙소별 내역';
    const rows = stats
      .filter(s => s.total > 0)
      .map(s => {
        const propDetail = Object.entries(s.properties).map(([name, cnt]) => `${name}(${cnt})`).join(' / ');
        return `${s.cleanerName},${s.done},${s.pending},${s.total},"${propDetail}"`;
      });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `청소보고서_${monthStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-10">
      {/* Header */}
      <header className="border-b border-white/10 pb-6 sm:pb-8 flex flex-col sm:flex-row gap-4 sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-3">보고서</p>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-white">청소 완료 보고서</h1>
          <p className="text-white/50 mt-2 text-sm font-light">담당자별 월간 청소 현황을 확인합니다.</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center justify-center gap-2 px-5 py-3 border border-white/20 text-white/70 text-xs tracking-widest font-medium hover:border-white/40 hover:text-white active:scale-[0.98] transition-all rounded-lg shrink-0"
        >
          <Download size={14} />
          CSV 내보내기
        </button>
      </header>

      {/* Month selector */}
      <div className="flex items-center justify-center gap-6">
        <button onClick={prevMonth} className="p-2 text-white/40 hover:text-white active:scale-90 transition-all">
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-xl sm:text-2xl font-light text-white tracking-wide min-w-[140px] text-center">
          {format(viewDate, 'yyyy년 M월', { locale: ko })}
        </h2>
        <button onClick={nextMonth} className="p-2 text-white/40 hover:text-white active:scale-90 transition-all">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`rounded-2xl p-4 sm:p-5 text-center ${totalDone > 0 ? 'bg-emerald-500/[0.08] border border-emerald-500/20' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          <p className={`text-2xl sm:text-3xl font-light mb-1 ${totalDone > 0 ? 'text-emerald-400' : 'text-white/20'}`}>{totalDone}</p>
          <p className="text-[11px] sm:text-xs text-white/40 tracking-wide">완료</p>
        </div>
        <div className={`rounded-2xl p-4 sm:p-5 text-center ${(totalAll - totalDone) > 0 ? 'bg-amber-500/[0.08] border border-amber-500/20' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          <p className={`text-2xl sm:text-3xl font-light mb-1 ${(totalAll - totalDone) > 0 ? 'text-amber-400' : 'text-white/20'}`}>{totalAll - totalDone}</p>
          <p className="text-[11px] sm:text-xs text-white/40 tracking-wide">대기</p>
        </div>
        <div className={`rounded-2xl p-4 sm:p-5 text-center ${unassigned > 0 ? 'bg-rose-500/[0.08] border border-rose-500/20' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
          <p className={`text-2xl sm:text-3xl font-light mb-1 ${unassigned > 0 ? 'text-rose-400' : 'text-white/20'}`}>{unassigned}</p>
          <p className="text-[11px] sm:text-xs text-white/40 tracking-wide">미배정</p>
        </div>
      </div>

      {/* Monthly trend chart */}
      <div className="bg-[#111] border border-white/10 rounded-2xl p-5 sm:p-6">
        <h3 className="text-sm font-medium text-white/60 mb-5 tracking-wide">월별 청소 완료 추이</h3>
        <div className="flex items-end gap-2 sm:gap-3 h-32">
          {monthlyTrend.map(m => {
            const height = maxTrend > 0 ? (m.count / maxTrend) * 100 : 0;
            const isCurrent = m.month === monthStr;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                <span className={`text-xs tabular-nums ${isCurrent ? 'text-white' : 'text-white/30'}`}>
                  {m.count}
                </span>
                <div className="w-full flex justify-center">
                  <div
                    className={`w-full max-w-[40px] rounded-t-lg transition-all ${
                      isCurrent ? 'bg-emerald-500/40' : 'bg-white/10'
                    }`}
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                </div>
                <span className={`text-[10px] sm:text-[11px] ${isCurrent ? 'text-white font-medium' : 'text-white/30'}`}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-cleaner stats */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white/60 tracking-wide">담당자별 현황</h3>

        {stats.length === 0 ? (
          <div className="text-center py-16 bg-[#111] border border-white/10 rounded-2xl">
            <FileBarChart size={32} className="mx-auto mb-3 text-white/15" />
            <p className="text-white/30 text-sm">등록된 청소 담당자가 없습니다.</p>
          </div>
        ) : (
          stats.map(stat => {
            const completionRate = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0;
            return (
              <div key={stat.cleanerId} className="bg-[#111] border border-white/10 rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-base font-medium text-white">{stat.cleanerName}</p>
                    {stat.total > 0 ? (
                      <p className="text-xs text-white/40 mt-0.5">
                        완료율 {completionRate}%
                      </p>
                    ) : (
                      <p className="text-xs text-white/25 mt-0.5">이번 달 배정 없음</p>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 shrink-0">
                    <span className="text-2xl font-light text-emerald-400">{stat.done}</span>
                    <span className="text-sm text-white/25">/ {stat.total}</span>
                  </div>
                </div>

                {stat.total > 0 && (
                  <>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-emerald-500/60 rounded-full transition-all"
                        style={{ width: `${completionRate}%` }}
                      />
                    </div>

                    {/* Per-property breakdown */}
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(stat.properties).map(([propName, count]) => (
                        <span
                          key={propName}
                          className="text-[11px] bg-white/[0.04] border border-white/[0.08] px-2.5 py-1 rounded-lg text-white/50"
                        >
                          {propName} <span className="text-white/70 font-medium">{count}건</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
