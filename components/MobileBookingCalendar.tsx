'use client';

import { useState } from 'react';
import { toDateStr } from '@/app/admin/calendar/types';

import { dayBookings, type MobileBooking } from '@/lib/mobile-booking-calendar';

export default function MobileBookingCalendar({ month, today, events, onEventClick }: {
  month: Date; today: string; events: MobileBooking[]; onEventClick: (id: string) => void;
}) {
  const monthKey = toDateStr(month).slice(0, 7);
  const [date, setDate] = useState(today.startsWith(monthKey) ? today : `${monthKey}-01`);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days = Array.from({ length: Math.ceil((first.getDay() + last.getDate()) / 7) * 7 }, (_, i) =>
    new Date(month.getFullYear(), month.getMonth(), i - first.getDay() + 1));
  const selected = dayBookings(events, date);
  return <section className="min-w-0 space-y-4" aria-label="날짜별 예약 보기">
    <div className="rounded-2xl border border-stone-200 bg-white p-2">
      <div className="grid grid-cols-7 text-center text-xs text-stone-500">{['일','월','화','수','목','금','토'].map(d => <span className="py-2" key={d}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1">{days.map(d => {
        const key = toDateStr(d), inMonth = key.startsWith(monthKey);
        const count = dayBookings(events, key).length;
        return <button key={key} type="button" disabled={!inMonth} aria-pressed={key === date}
          aria-label={`${d.getMonth()+1}월 ${d.getDate()}일, 일정 ${count}건${key===today?', 오늘':''}`}
          onClick={() => setDate(key)}
          className={`min-h-14 min-w-0 rounded-xl py-1 text-center ${!inMonth?'opacity-20':key===date?'bg-stone-900 text-white':key===today?'bg-amber-50 text-amber-900':'text-stone-700'}`}>
          <span className="block text-sm font-medium">{d.getDate()}</span>
          <span className="block text-[10px] leading-4">{count ? `${count}건` : '·'}</span>
        </button>;
      })}</div>
    </div>
    <p className="text-xs text-stone-500">날짜를 누르면 아래에 체크인·체크아웃·투숙 일정이 표시됩니다.</p>
    <div aria-live="polite" className="flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{Number(date.slice(5,7))}월 {Number(date.slice(8))}일{date===today?' · 오늘':''}</h2>
      <span className="text-sm text-stone-500">{selected.length}건</span>
    </div>
    {!selected.length && <p className="rounded-xl bg-stone-50 p-5 text-sm text-stone-500">선택한 날짜에 표시할 일정이 없습니다.</p>}
    <div className="space-y-3">{selected.map(e => {
      const label = e.type==='block'?'차단 · 정비':e.end===date?'체크아웃':e.start===date?'체크인':'투숙 중';
      return <button key={e.id} type="button" onClick={() => onEventClick(e.id)} className="block w-full min-w-0 rounded-2xl border border-stone-200 bg-white p-4 text-left active:bg-stone-50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold break-words">{e.propertyName || '예약 일정'}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs ${e.type==='block'?'bg-stone-100 text-stone-600':e.end===date?'bg-amber-50 text-amber-900':e.start===date?'bg-blue-50 text-blue-800':'bg-emerald-50 text-emerald-800'}`}>{label}</span>
        </div>
        <p className="mt-3 break-words text-base text-stone-900">{e.title}</p>
        <p className="mt-2 text-sm text-stone-500">{e.start.slice(5).replace('-','/')} → {e.end.slice(5).replace('-','/')}</p>
        {e.type==='reservation' && e.end===date && 'cleanerName' in e && <p className="mt-2 text-sm text-stone-600">청소 · {e.cleanerName ? `${e.cleanerName}${e.cleaningDone?' (완료)':''}` : '담당자 미배정'}</p>}
        <span className="mt-3 block text-xs text-stone-500">예약 상세 보기 →</span>
      </button>;
    })}</div>
  </section>;
}
