'use client';

import { Check, Sparkles } from 'lucide-react';
import { DAY_LABELS, type Property, type ProcessedEvent, hexToRgba, toDateStr } from '../types';

interface CalendarGridProps {
  weeks: Date[][];
  viewDate: Date;
  today: string;
  activeProperties: Property[];
  eventsByProp: Map<string, ProcessedEvent[]>;
  openModal: (e: ProcessedEvent) => void;
}

function getDayInfo(dayStr: string, propId: string, eventsByProp: Map<string, ProcessedEvent[]>) {
  const eventsForProp = eventsByProp.get(propId) || [];
  const checkoutEvent = eventsForProp.find(e => e.end === dayStr) ?? null;
  const checkinEvent = eventsForProp.find(e => e.start === dayStr) ?? null;
  const midEvent = (!checkinEvent && !checkoutEvent)
    ? (eventsForProp.find(e => e.start < dayStr && e.end > dayStr) ?? null)
    : null;
  return { checkoutEvent, checkinEvent, midEvent };
}

function getDayAvailability(dayStr: string, activeProperties: Property[], eventsByProp: Map<string, ProcessedEvent[]>) {
  const total = activeProperties.length;
  let available = 0;
  for (const prop of activeProperties) {
    const { checkinEvent, midEvent } = getDayInfo(dayStr, prop.id, eventsByProp);
    if (!checkinEvent && !midEvent) available++;
  }
  return { available, total };
}

function CleanBadge({ evt }: { evt: ProcessedEvent }) {
  if (evt.cleanerName) {
    const isDone = evt.status === 'done';
    return (
      <span
        className={`mx-1 text-[9px] leading-none px-1.5 py-1 font-semibold shrink-0 whitespace-nowrap inline-flex items-center gap-1 ${
          isDone
            ? 'bg-emerald-500 text-white ring-1 ring-emerald-600/30'
            : 'bg-white text-stone-800 ring-1 ring-stone-300'
        }`}
      >
        {isDone ? <Check size={9} strokeWidth={3} /> : <Sparkles size={9} strokeWidth={2.5} />}
        {evt.cleanerName}
      </span>
    );
  }
  return (
    <span className="mx-1 text-[9px] leading-none px-1.5 py-1 font-semibold shrink-0 whitespace-nowrap bg-white text-amber-700 ring-1 ring-amber-400">
      미배정
    </span>
  );
}

// 차단(객실정비 포함)은 빗금으로 그려 예약과 구분한다.
function eventBg(evt: ProcessedEvent): React.CSSProperties {
  if (evt.type !== 'block') return { backgroundColor: evt.color };
  return {
    backgroundColor: evt.color,
    backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.28) 0 5px, transparent 5px 12px)',
  };
}

function BlockLabel({ evt }: { evt: ProcessedEvent }) {
  return (
    <span className="mx-1 text-[9px] leading-none px-1.5 py-1 font-semibold shrink-0 whitespace-nowrap bg-white/90 text-slate-700 ring-1 ring-slate-300">
      {evt.source === 'maintenance' ? '정비' : '차단'}
    </span>
  );
}

function GridLine({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="absolute right-0 top-0 w-px h-full bg-black/15 z-10 pointer-events-none" />;
}

function DayCell({ day, di, viewDate, today, activeProperties, eventsByProp }: {
  day: Date; di: number; viewDate: Date; today: string;
  activeProperties: Property[]; eventsByProp: Map<string, ProcessedEvent[]>;
}) {
  const dateStr = toDateStr(day);
  const isThisMonth = day.getMonth() === viewDate.getMonth();
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const weekendBg = di === 0 ? 'bg-rose-50/40' : di === 6 ? 'bg-sky-50/40' : '';
  const avail = isThisMonth && activeProperties.length > 0 ? getDayAvailability(dateStr, activeProperties, eventsByProp) : null;
  const allAvailable = avail && avail.available === avail.total && avail.total > 0;
  const noneAvailable = avail && avail.available === 0 && avail.total > 0;

  const dayNumberCls = isToday
    ? 'bg-[var(--brand)] text-white font-bold'
    : !isThisMonth
      ? 'text-stone-300'
      : di === 0
        ? 'text-rose-500 font-semibold'
        : di === 6
          ? 'text-sky-600 font-semibold'
          : 'text-stone-900 font-medium';

  return (
    <div className={`py-2 px-2 flex items-center justify-between gap-1 ${isToday ? 'bg-[var(--brand-tint)]' : weekendBg} ${di < 6 ? 'border-r border-stone-200' : ''}`}>
      <div className="min-w-0 flex items-center gap-1">
        {avail && !isPast && isThisMonth && (
          <span className="inline-flex items-center gap-1 shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                allAvailable ? 'bg-emerald-500' :
                noneAvailable ? 'bg-rose-500' :
                'bg-amber-500'
              }`}
            />
            <span className={`text-[9px] tabular-nums font-medium tracking-tight hidden sm:inline ${
              allAvailable ? 'text-emerald-700' :
              noneAvailable ? 'text-rose-600' :
              'text-amber-700'
            }`}>
              {avail.available}/{avail.total}
            </span>
          </span>
        )}
      </div>
      <span className={`text-sm inline-flex items-center justify-center w-7 h-7 transition-colors tabular-nums ${dayNumberCls}`}>
        {day.getDate()}
      </span>
    </div>
  );
}

function PropertyLaneCell({ day, di, prop, weekStartStr, today, viewDate, eventsByProp, openModal }: {
  day: Date; di: number; prop: Property; weekStartStr: string;
  today: string; viewDate: Date; eventsByProp: Map<string, ProcessedEvent[]>;
  openModal: (e: ProcessedEvent) => void;
}) {
  const dayStr = toDateStr(day);
  const { checkoutEvent, checkinEvent, midEvent } = getDayInfo(dayStr, prop.id, eventsByProp);
  const isToday = dayStr === today;
  const bgEmpty = hexToRgba(prop.color, 0.025);
  const weekendBg = di === 0 ? 'rgba(244,63,94,0.025)' : di === 6 ? 'rgba(14,165,233,0.025)' : undefined;
  const emptyBg = weekendBg || bgEmpty;
  const showGridLine = di < 6;
  const todayRing = isToday ? 'ring-1 ring-inset ring-[var(--brand)]/40' : '';

  // Mid-stay
  if (midEvent) {
    const showLabel = di === 0 && midEvent.start < weekStartStr;
    return (
      <div className={`relative h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden ${todayRing}`}
        onClick={() => openModal(midEvent)}
        style={eventBg(midEvent)}
      >
        {showLabel && (
          <span className="px-2 text-[11px] font-semibold text-white truncate leading-none drop-shadow-sm">
            {midEvent.title}
          </span>
        )}
        <GridLine show={showGridLine} />
      </div>
    );
  }

  // Checkout + Checkin split
  if (checkoutEvent && checkinEvent) {
    return (
      <div className={`relative h-full flex ${todayRing}`} style={{ gap: '2px' }}>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkoutEvent)}
          style={{ width: '50%', ...eventBg(checkoutEvent), borderRadius: 0, opacity: 0.85,
            outline: checkoutEvent.type !== 'block' && !checkoutEvent.cleanerId ? '2px dashed rgba(245,158,11,0.85)' : 'none', outlineOffset: '-2px' }}
        >
          {checkoutEvent.type === 'block' ? <BlockLabel evt={checkoutEvent} /> : <CleanBadge evt={checkoutEvent} />}
        </div>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkinEvent)}
          style={{ width: '50%', ...eventBg(checkinEvent), borderRadius: 0 }}
        >
          <span className="px-1.5 text-[11px] font-semibold text-white truncate leading-none drop-shadow-sm">
            {checkinEvent.title}
          </span>
        </div>
        <GridLine show={showGridLine} />
      </div>
    );
  }

  // Checkout only
  if (checkoutEvent) {
    return (
      <div className={`relative h-full flex items-center ${todayRing}`} style={{ backgroundColor: emptyBg }}>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkoutEvent)}
          style={{ width: '50%', ...eventBg(checkoutEvent), borderRadius: 0, opacity: 0.85,
            outline: checkoutEvent.type !== 'block' && !checkoutEvent.cleanerId ? '2px dashed rgba(245,158,11,0.85)' : 'none', outlineOffset: '-2px' }}
        >
          {checkoutEvent.type === 'block' ? <BlockLabel evt={checkoutEvent} /> : <CleanBadge evt={checkoutEvent} />}
        </div>
        <GridLine show={showGridLine} />
      </div>
    );
  }

  // Checkin only
  if (checkinEvent) {
    return (
      <div className={`relative h-full flex items-center justify-end ${todayRing}`} style={{ backgroundColor: emptyBg }}>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkinEvent)}
          style={{ width: '50%', ...eventBg(checkinEvent), borderRadius: 0 }}
        >
          <span className="px-2 text-[11px] font-semibold text-white truncate leading-none drop-shadow-sm">
            {checkinEvent.title}
          </span>
        </div>
        <GridLine show={showGridLine} />
      </div>
    );
  }

  // Empty
  const dayIsPast = dayStr < today;
  return (
    <div className={`relative h-full flex items-center justify-center ${todayRing}`} style={{ backgroundColor: emptyBg }}>
      {!dayIsPast && day.getMonth() === viewDate.getMonth() && (
        <span className="w-1 h-1 rounded-full bg-emerald-500/30" />
      )}
      <GridLine show={showGridLine} />
    </div>
  );
}

const LABEL_COL_CLS = 'sticky left-0 z-20 w-[64px] sm:w-[92px] shrink-0 border-r-2 border-stone-300';

export function CalendarGrid({ weeks, viewDate, today, activeProperties, eventsByProp, openModal }: CalendarGridProps) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="bg-white border border-stone-200 overflow-hidden min-w-[540px] mx-4 md:mx-0">
        {/* Day of week header */}
        <div className="flex border-b border-stone-200 bg-stone-50">
          <div className={`${LABEL_COL_CLS} bg-stone-50 flex items-center justify-center py-3`}>
            <span className="text-xs font-semibold text-stone-500">숙소</span>
          </div>
          <div className="flex-1 grid grid-cols-7 min-w-0">
            {DAY_LABELS.map((label, i) => (
              <div key={i} className={`py-3 text-center text-xs font-semibold ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-600' : 'text-stone-700'} ${i < 6 ? 'border-r border-stone-200' : ''}`}>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className={wi < weeks.length - 1 ? 'border-b border-stone-200' : ''}>
            {/* Day number row */}
            <div className="flex border-b border-stone-200">
              <div className={`${LABEL_COL_CLS} bg-white`} />
              <div className="flex-1 grid grid-cols-7 min-w-0">
                {week.map((day, di) => (
                  <DayCell key={di} day={day} di={di} viewDate={viewDate} today={today}
                    activeProperties={activeProperties} eventsByProp={eventsByProp} />
                ))}
              </div>
            </div>

            {activeProperties.length > 0 && (
              <div className="space-y-0">
                {activeProperties.map((prop, pi) => {
                  const weekStartStr = toDateStr(week[0]);
                  return (
                    <div key={prop.id}
                      className={`flex ${pi < activeProperties.length - 1 ? 'border-b border-stone-200' : ''}`}
                      style={{ height: '36px' }}
                    >
                      <div
                        className={`${LABEL_COL_CLS} flex items-center gap-1.5 px-2 bg-white`}
                        title={prop.name}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0 ring-2" style={{ backgroundColor: prop.color, '--tw-ring-color': hexToRgba(prop.color, 0.2) } as React.CSSProperties} />
                        <span className="text-[11px] text-stone-700 font-medium truncate">
                          {prop.name}
                        </span>
                      </div>
                      <div className="flex-1 grid grid-cols-7 min-w-0">
                        {week.map((day, di) => (
                          <PropertyLaneCell key={di} day={day} di={di} prop={prop}
                            weekStartStr={weekStartStr} today={today} viewDate={viewDate}
                            eventsByProp={eventsByProp} openModal={openModal} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
