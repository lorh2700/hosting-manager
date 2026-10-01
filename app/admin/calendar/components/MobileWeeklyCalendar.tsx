'use client';

import { useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import { weeklyStayLayout } from '@/lib/weekly-stay-layout';
import { getChannelLabel, toDateStr, hexToRgba, type Property, type ProcessedEvent } from '../types';
import styles from './MobileWeeklyCalendar.module.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatStayDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${year}. ${month}. ${day} (${WEEKDAYS[date.getDay()]})`;
}

function shortStayDate(value: string) {
  const [, month, day] = value.slice(0, 10).split('-').map(Number);
  return `${month}/${day}`;
}

function sourceLabel(event: ProcessedEvent, channelMap: Record<string, string>) {
  if (event.channelId === 'direct') return '직접예약';
  if (event.channelId === 'beds24') {
    const source = event.source?.trim();
    if (!source) return 'Beds24';
    // Unknown Beds24 sources must not be presented as direct reservations.
    const label = getChannelLabel(event.channelId, source, channelMap);
    return label === '직접예약' && source.toLowerCase() !== 'direct' ? source : label;
  }
  return channelMap[event.channelId] || event.source?.trim() || event.channelId;
}

export function MobileWeeklyCalendar({ viewDate, today, onDateChange, properties, eventsByProp, channelMap = {}, openModal }: {
  viewDate: Date;
  today: string;
  onDateChange: (date: Date) => void;
  properties: Property[];
  eventsByProp: Map<string, ProcessedEvent[]>;
  channelMap?: Record<string, string>;
  openModal: (event: ProcessedEvent) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate());
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const start = toDateStr(first);
  const lanes = properties.map(property => ({ property, bars: weeklyStayLayout(eventsByProp.get(property.id) || [], start) }));
  const visibleEvents = lanes.flatMap(lane => lane.bars.map(bar => bar.event));
  const selected = visibleEvents.find(event => event.id === selectedId)
    ?? visibleEvents.find(event => event.type === 'reservation' && event.start <= today && event.end >= today)
    ?? visibleEvents.find(event => event.type === 'reservation')
    ?? visibleEvents[0];
  const selectedSource = selected ? sourceLabel(selected, channelMap) : '';
  const fmt = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
  const move = (amount: number) => onDateChange(new Date(first.getFullYear(), first.getMonth(), first.getDate() + amount));

  return <section className={styles.workspace} aria-label="숙소별 주간 투숙기간">
    <div className={styles.nav}>
      <button type="button" aria-label="이전 주" onClick={() => move(-7)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className={styles.range} aria-live="polite">
        {fmt(first)} – {fmt(days[6])}
        <small>{first.getFullYear() === days[6].getFullYear() ? `${first.getFullYear()}년` : `${first.getFullYear()}–${days[6].getFullYear()}년`} · 주간 보기</small>
      </div>
      <button type="button" aria-label="다음 주" onClick={() => move(7)}><ChevronRight size={18} aria-hidden="true" /></button>
      <button type="button" onClick={() => {
        const [year, month, day] = today.split('-').map(Number);
        onDateChange(new Date(year, month - 1, day));
      }}>오늘</button>
    </div>

    <div aria-live="polite" aria-atomic="true" className={styles.summary}>
      {selected ? <>
        <div className={styles.summaryHeading}>
          <p className={styles.summaryLabel}>선택한 {selected.type === 'block' ? (selected.source === 'maintenance' ? '정비 일정' : '차단 일정') : '예약'}</p>
          {selectedSource && <span className={styles.source}>{selectedSource}</span>}
        </div>
        <h2 className={styles.summaryTitle}>{selected.propName} <span>· {selected.title}</span></h2>
        <dl className={styles.stayDates}>
          <div><dt>{selected.type === 'block' ? '시작' : '입실'}</dt><dd>{formatStayDate(selected.start)}</dd></div>
          <div><dt>{selected.type === 'block' ? '종료' : '퇴실'}</dt><dd>{formatStayDate(selected.end)}</dd></div>
        </dl>
        <div className={styles.summaryFooter}>
          {selected.type === 'reservation' && <div className={styles.cleaning}>
            <span>퇴실 청소</span>
            <span className={`${styles.status} ${selected.status === 'done' ? styles.statusDone : selected.cleanerId ? styles.statusAssigned : styles.statusPending}`}>
              {selected.status === 'done' ? '완료' : selected.cleanerId ? '배정' : '미배정'}
            </span>
            {(selected.cleanerName || selected.cleanerId || selected.status === 'done') && <strong>{selected.cleanerName || (selected.cleanerId ? '담당자 이름 확인 필요' : '담당자 없음')}</strong>}
          </div>}
          <button type="button" className={styles.detailButton} onClick={() => openModal(selected)}>
            {selected.type === 'block' ? '일정 상세 보기' : '예약 상세 보기'}<ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </> : <p className={styles.summaryPrompt}>{properties.length ? '이번 주에 표시된 예약이 없습니다. 다른 주를 선택해 확인하세요.' : '표시할 숙소를 선택해 주세요.'}</p>}
    </div>

    <div className={styles.calendar}>
      <div className={styles.dates}>
        <div className={styles.propertyLabel}>숙소</div>
        {days.map(date => <div key={toDateStr(date)} className={styles.day} aria-label={`${toDateStr(date)}${toDateStr(date) === today ? ', 오늘' : ''}`}>
          {WEEKDAYS[date.getDay()]}<strong className={toDateStr(date) === today ? styles.today : undefined}>{date.getDate()}</strong>
        </div>)}
      </div>
      {lanes.map(({ property, bars }) => <div key={property.id} className={styles.lane} style={{ minHeight: Math.max(1, ...bars.map(bar => bar.row + 1)) * 56 + 16 }}>
        <div className={styles.name}>{property.name}</div>
        <div className={styles.track}>
          {bars.length ? bars.map(bar => <button key={bar.event.id} type="button"
            className={`${styles.bar} ${bar.event.type === 'block' ? bar.event.source === 'maintenance' ? styles.maintenance : styles.block : ''} ${selected?.id === bar.event.id ? styles.selected : ''}`}
            style={{ left: `${bar.left}%`, width: `calc(${bar.width}% - 2px)`, top: 8 + bar.row * 56,
              backgroundColor: hexToRgba(bar.event.color, bar.event.type === 'block' ? 0.16 : 0.18),
              borderTopLeftRadius: bar.continuesBefore ? 0 : undefined, borderBottomLeftRadius: bar.continuesBefore ? 0 : undefined,
              borderTopRightRadius: bar.continuesAfter ? 0 : undefined, borderBottomRightRadius: bar.continuesAfter ? 0 : undefined }}
            aria-pressed={selected?.id === bar.event.id}
            title={`${property.name} · ${bar.event.title} · ${formatStayDate(bar.event.start)}–${formatStayDate(bar.event.end)}`}
            aria-label={`${property.name}, ${bar.event.title}, ${bar.event.start}부터 ${bar.event.end}까지${bar.event.type === 'block' ? bar.event.source === 'maintenance' ? ', 객실 정비' : ', 차단' : `, 퇴실 청소 ${bar.event.status === 'done' ? '완료' : bar.event.cleanerName || (bar.event.cleanerId ? '배정' : '미배정')}`}`}
            onClick={() => setSelectedId(bar.event.id)}>
            {bar.continuesBefore && <span className={styles.continuation} aria-hidden="true">‹</span>}
            <span className={styles.barText}>
              <strong>{bar.event.type === 'block' ? <>{bar.event.source === 'maintenance' ? <Wrench size={12} aria-hidden="true" /> : <Ban size={12} aria-hidden="true" />}{bar.event.source === 'maintenance' ? '정비' : '차단'}</> : bar.event.title}</strong>
              <small>{shortStayDate(bar.event.start)}–{shortStayDate(bar.event.end)}</small>
            </span>
            {bar.continuesAfter && <span className={styles.continuation} aria-hidden="true">›</span>}
          </button>) : <span className={styles.empty}>표시된 예약 없음</span>}
        </div>
      </div>)}
      {!properties.length && <p className={styles.noProperties}>표시할 숙소를 선택해 주세요.</p>}
    </div>
    <div className={styles.legend} aria-label="투숙기간 표시 안내">
      <span><i className={styles.stayKey} aria-hidden="true" />투숙기간</span>
      <span><i className={styles.blockKey} aria-hidden="true" />정비·차단</span>
      <span>반 칸 · 입실/퇴실</span>
      <span>‹ › · 다른 주로 이어짐</span>
    </div>
  </section>;
}
