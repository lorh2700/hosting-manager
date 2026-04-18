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
        className={`mx-1 text-[9px] leading-none px-1.5 py-1 rounded-md font-semibold shrink-0 whitespace-nowrap inline-flex items-center gap-1 ${
          isDone
            ? 'bg-emerald-500/85 text-white ring-1 ring-emerald-300/40'
            : 'bg-black/55 text-white ring-1 ring-white/20'
        }`}
      >
        {isDone ? <Check size={9} strokeWidth={3} /> : <Sparkles size={9} strokeWidth={2.5} />}
        {evt.cleanerName}
      </span>
    );
  }
  return (
    <span className="mx-1 text-[9px] leading-none px-1.5 py-1 rounded-md font-bold shrink-0 whitespace-nowrap bg-amber-500 text-black ring-1 ring-amber-300">
      미배정
    </span>
  );
}

function GridLine({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="absolute right-0 top-0 w-px h-full bg-white/30 z-10 pointer-events-none" />;
}

function DayCell({ day, di, viewDate, today, activeProperties, eventsByProp }: {
  day: Date; di: number; viewDate: Date; today: string;
  activeProperties: Property[]; eventsByProp: Map<string, ProcessedEvent[]>;
}) {
  const dateStr = toDateStr(day);
  const isThisMonth = day.getMonth() === viewDate.getMonth();
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const weekendBg = di === 0 ? 'bg-red-500/[0.06]' : di === 6 ? 'bg-blue-500/[0.06]' : '';
  const avail = isThisMonth && activeProperties.length > 0 ? getDayAvailability(dateStr, activeProperties, eventsByProp) : null;
  const allAvailable = avail && avail.available === avail.total && avail.total > 0;
  const noneAvailable = avail && avail.available === 0 && avail.total > 0;

  const dayNumberCls = isToday
    ? 'bg-white text-black font-bold shadow-lg shadow-white/10'
    : !isThisMonth
      ? 'text-white/25 font-light'
      : di === 0
        ? 'text-red-300 font-semibold'
        : di === 6
          ? 'text-blue-300 font-semibold'
          : 'text-white/90 font-medium';

  return (
    <div className={`py-2 px-2 flex items-center justify-between gap-1 ${isToday ? 'bg-white/[0.08]' : weekendBg} ${di < 6 ? 'border-r border-white/30' : ''}`}>
      <div className="min-w-0 flex items-center gap-1">
        {avail && !isPast && isThisMonth && (
          <span className="inline-flex items-center gap-1 shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                allAvailable ? 'bg-emerald-400' :
                noneAvailable ? 'bg-rose-400' :
                'bg-amber-400'
              }`}
            />
            <span className={`text-[9px] tabular-nums font-medium tracking-tight hidden sm:inline ${
              allAvailable ? 'text-emerald-300/80' :
              noneAvailable ? 'text-rose-300/70' :
              'text-amber-300/80'
            }`}>
              {avail.available}/{avail.total}
            </span>
          </span>
        )}
      </div>
      <span className={`text-sm inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors tabular-nums ${dayNumberCls}`}>
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
  const bgEmpty = hexToRgba(prop.color, 0.05);
  const weekendBg = di === 0 ? 'rgba(239,68,68,0.035)' : di === 6 ? 'rgba(59,130,246,0.035)' : undefined;
  const emptyBg = weekendBg || bgEmpty;
  const showGridLine = di < 6;
  const todayRing = isToday ? 'ring-1 ring-inset ring-white/20' : '';

  // Mid-stay
  if (midEvent) {
    const showLabel = di === 0 && midEvent.start < weekStartStr;
    return (
      <div className={`relative h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden ${todayRing}`}
        onClick={() => openModal(midEvent)}
        style={{ backgroundColor: midEvent.color }}
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
          style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0', opacity: 0.85,
            outline: !checkoutEvent.cleanerId ? '2px dashed rgba(245,158,11,0.85)' : 'none', outlineOffset: '-2px' }}
        >
          <CleanBadge evt={checkoutEvent} />
        </div>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkinEvent)}
          style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
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
          style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0', opacity: 0.85,
            outline: !checkoutEvent.cleanerId ? '2px dashed rgba(245,158,11,0.85)' : 'none', outlineOffset: '-2px' }}
        >
          <CleanBadge evt={checkoutEvent} />
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
          style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
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

export function CalendarGrid({ weeks, viewDate, today, activeProperties, eventsByProp, openModal }: CalendarGridProps) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl overflow-hidden min-w-[520px] mx-4 md:mx-0 shadow-xl shadow-black/30">
        {/* Day of week header */}
        <div className="grid grid-cols-7 border-b border-white/15 bg-white/[0.03]">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className={`py-3 text-center text-[11px] tracking-[0.25em] font-semibold uppercase ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-white/55'} ${i < 6 ? 'border-r border-white/15' : ''}`}>
              {label}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className={wi < weeks.length - 1 ? 'border-b border-white/25' : ''}>
            <div className="grid grid-cols-7 border-b border-white/20">
              {week.map((day, di) => (
                <DayCell key={di} day={day} di={di} viewDate={viewDate} today={today}
                  activeProperties={activeProperties} eventsByProp={eventsByProp} />
              ))}
            </div>

            {activeProperties.length > 0 && (
              <div className="space-y-0">
                {activeProperties.map((prop, pi) => {
                  const weekStartStr = toDateStr(week[0]);
                  return (
                    <div key={prop.id}
                      className={`grid grid-cols-7 ${pi < activeProperties.length - 1 ? 'border-b border-white/[0.04]' : ''}`}
                      style={{ height: '36px' }}
                    >
                      {week.map((day, di) => (
                        <PropertyLaneCell key={di} day={day} di={di} prop={prop}
                          weekStartStr={weekStartStr} today={today} viewDate={viewDate}
                          eventsByProp={eventsByProp} openModal={openModal} />
                      ))}
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
