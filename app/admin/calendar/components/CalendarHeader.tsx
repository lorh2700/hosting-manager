'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { ProcessedEvent } from '../types';

interface CalendarHeaderProps {
  viewDate: Date;
  prevMonth: () => void;
  nextMonth: () => void;
  goToday: () => void;
  unassignedCleanings: ProcessedEvent[];
  sortedUnassigned: ProcessedEvent[];
  openModal: (e: ProcessedEvent) => void;
}

export function CalendarHeader({
  viewDate, prevMonth, nextMonth, goToday,
  unassignedCleanings, sortedUnassigned, openModal,
}: CalendarHeaderProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/beds24/sync-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setSyncMessage(data.message || data.error || '동기화 실패');
        return;
      }
      const created = data.totalCreated ?? 0;
      const updated = data.totalUpdated ?? 0;
      const removed = data.totalRemoved ?? 0;
      setSyncMessage(`신규 ${created} · 변경 ${updated} · 삭제 ${removed}`);
      window.location.reload();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <header className="pb-6 border-b border-white/10 flex flex-col sm:flex-row gap-4 sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">캘린더</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">통합 캘린더</h1>
          <p className="text-white/40 mt-2 text-sm font-light tracking-wide">모든 숙소의 투숙 및 청소 일정</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={prevMonth} className="p-2.5 text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-white font-light text-base px-4 min-w-[140px] text-center tabular-nums">
            {viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월
          </span>
          <button onClick={nextMonth} className="p-2.5 text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
            <ChevronRight size={16} />
          </button>
          <button onClick={goToday} className="ml-2 px-3.5 py-2.5 text-[11px] uppercase tracking-widest font-semibold text-white/50 border border-white/10 hover:text-white hover:border-white/30 rounded-lg transition-colors">
            오늘
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            title="Beds24 전체 동기화"
            className="ml-1 px-3.5 py-2.5 text-[11px] uppercase tracking-widest font-semibold text-white/50 border border-white/10 hover:text-white hover:border-white/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '동기화 중' : '동기화'}
          </button>
        </div>
      </header>

      {syncMessage && (
        <div className="text-[11px] text-white/50 tracking-wide font-light -mt-2">
          {syncMessage}
        </div>
      )}

      {unassignedCleanings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <p className="text-sm text-amber-200/90 font-light">
              <span className="font-semibold">{unassignedCleanings.length}건</span>의 예약에 청소 담당자가 지정되지 않았습니다
            </p>
          </div>
          <button
            onClick={() => { if (sortedUnassigned[0]) openModal(sortedUnassigned[0]); }}
            className="px-3.5 py-1.5 text-[11px] tracking-widest font-semibold text-amber-300 border border-amber-500/30 hover:bg-amber-500/15 rounded-lg transition-colors whitespace-nowrap"
          >
            지정하기
          </button>
        </div>
      )}
    </>
  );
}
