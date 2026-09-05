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

  const navBtnCls = 'p-2.5 text-stone-500 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 transition-colors';
  const pillBtnCls = 'px-3 sm:px-3.5 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 hover:text-stone-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5';

  return (
    <>
      <header className="pb-6 border-b border-stone-200 flex flex-col sm:flex-row gap-4 sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">캘린더</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">통합 캘린더</h1>
          <p className="text-stone-500 mt-2 text-sm">모든 숙소의 투숙 및 청소 일정</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={prevMonth} className={navBtnCls}>
            <ChevronLeft size={16} />
          </button>
          <span className="text-stone-900 font-semibold text-base px-3 sm:px-4 min-w-[110px] sm:min-w-[140px] text-center tabular-nums">
            {viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월
          </span>
          <button onClick={nextMonth} className={navBtnCls}>
            <ChevronRight size={16} />
          </button>
          <button onClick={goToday} className={pillBtnCls + ' ml-1 sm:ml-2'}>
            오늘
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            title="Beds24 전체 동기화"
            className={pillBtnCls}
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{syncing ? '동기화 중' : '동기화'}</span>
          </button>
        </div>
      </header>

      {syncMessage && (
        <div className="text-xs text-stone-500 -mt-2">
          {syncMessage}
        </div>
      )}

      {unassignedCleanings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{unassignedCleanings.length}건</span>의 예약에 청소 담당자가 지정되지 않았습니다
            </p>
          </div>
          <button
            onClick={() => { if (sortedUnassigned[0]) openModal(sortedUnassigned[0]); }}
            className="px-3.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 transition-colors whitespace-nowrap"
          >
            지정하기
          </button>
        </div>
      )}
    </>
  );
}
