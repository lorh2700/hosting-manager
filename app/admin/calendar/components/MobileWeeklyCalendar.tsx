'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { weeklyStayLayout } from '@/lib/weekly-stay-layout';
import { toDateStr, hexToRgba, type Property, type ProcessedEvent } from '../types';
import styles from './MobileWeeklyCalendar.module.css';

export function MobileWeeklyCalendar({ viewDate, today, onDateChange, properties, eventsByProp, openModal }: {
  viewDate: Date; today: string; onDateChange: (date: Date) => void;
  properties: Property[]; eventsByProp: Map<string, ProcessedEvent[]>; openModal: (event: ProcessedEvent) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate());
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const start = toDateStr(first);
  const lanes = properties.map(property => ({ property, bars: weeklyStayLayout(eventsByProp.get(property.id) || [], start) }));
  const selected = lanes.flatMap(l => l.bars).find(b => b.event.id === selectedId)?.event;
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  const move = (amount: number) => onDateChange(new Date(first.getFullYear(), first.getMonth(), first.getDate() + amount));
  return <section className="space-y-3" aria-label="숙소별 주간 투숙기간">
    <div className={styles.nav}>
      <button type="button" aria-label="이전 주" onClick={() => move(-7)}><ChevronLeft size={18}/></button>
      <div className={styles.range} aria-live="polite">{fmt(first)} – {fmt(days[6])}<small>{first.getFullYear()}년 · 주간 보기</small></div>
      <button type="button" aria-label="다음 주" onClick={() => move(7)}><ChevronRight size={18}/></button>
      <button type="button" onClick={() => onDateChange(new Date())}>오늘</button>
    </div>
    <div className={styles.calendar}>
      <div className={styles.dates}><div className={styles.day}>숙소</div>{days.map((d, i) => <div key={i} className={`${styles.day} ${toDateStr(d) === today ? styles.today : ''}`} aria-label={`${toDateStr(d)}${toDateStr(d) === today ? ', 오늘' : ''}`}>{['월','화','수','목','금','토','일'][i]}<strong>{d.getDate()}</strong></div>)}</div>
      {lanes.map(({ property, bars }) => <div key={property.id} className={styles.lane} style={{ minHeight: Math.max(1, ...bars.map(b => b.row + 1)) * 52 + 16 }}>
        <div className={styles.name}>{property.name}</div>
        <div className={styles.track}>{bars.length ? bars.map(b => <button key={b.event.id} type="button" className={`${styles.bar} ${selected?.id === b.event.id ? styles.selected : ''}`}
          style={{ left:`${b.left}%`, width:`calc(${b.width}% - 2px)`, top:8 + b.row * 52,
            backgroundColor:hexToRgba(b.event.color, 0.28), backgroundImage:b.event.type === 'block' ? 'repeating-linear-gradient(135deg, transparent 0 5px, rgba(100,116,139,.2) 5px 10px)' : undefined }}
          aria-pressed={selected?.id === b.event.id} aria-label={`${property.name}, ${b.event.title}, ${b.event.start}부터 ${b.event.end}까지${b.event.type === 'block' ? ', 차단' : ''}`}
          onClick={() => setSelectedId(b.event.id)}>{b.continuesBefore?'‹ ':''}{b.event.type === 'block' ? (b.event.source === 'maintenance' ? '정비' : '차단') : b.event.title}{b.continuesAfter?' ›':''}</button>) : <span className={styles.empty}>예약 없음</span>}</div>
      </div>)}
      {!properties.length && <p className="p-5 text-center text-sm text-stone-500">표시할 숙소를 선택해 주세요.</p>}
    </div>
    <p className="text-xs leading-5 text-stone-500">빈칸 · 예약 가능　반 칸 · 입실/퇴실　‹ › · 다른 주로 이어짐</p>
    <div aria-live="polite" className="rounded-xl border border-stone-200 bg-stone-50 p-4">
      {selected ? <><p className="text-xs text-stone-500">선택한 {selected.type === 'block' ? '차단 일정' : '예약'}</p><h2 className="mt-1 break-words text-lg font-semibold">{selected.propName} · {selected.title}</h2><p className="mt-2 text-sm">{selected.start} → {selected.end}</p>{selected.type === 'reservation' && <p className="mt-2 text-sm">퇴실 청소 · {selected.cleanerName || '미배정'}{selected.status === 'done' ? ' (완료)' : ''}</p>}<button type="button" onClick={() => openModal(selected)} className="mt-3 min-h-11 rounded-lg bg-stone-900 px-4 text-sm text-white">{selected.type === 'block' ? '일정 상세 보기' : '예약 상세 보기'}</button></> : <p className="text-sm text-stone-500">막대를 누르면 투숙기간과 청소 담당자가 여기에 표시됩니다.</p>}
    </div>
  </section>;
}
