'use client';

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
    const badgeBg = evt.status === 'done' ? 'rgba(16,185,129,0.7)' : 'rgba(0,0,0,0.45)';
    return (
      <span className="mx-0.5 text-[8px] leading-none px-1.5 py-0.5 rounded-full font-semibold shrink-0 whitespace-nowrap"
        style={{ backgroundColor: badgeBg, color: '#fff' }}>
        {evt.status === 'done' ? '✓' : '🧹'} {evt.cleanerName}
      </span>
    );
  }
  return (
    <span className="mx-0.5 text-[8px] leading-none px-1.5 py-0.5 rounded-full font-semibold shrink-0 whitespace-nowrap animate-pulse"
      style={{ backgroundColor: 'rgba(245,158,11,0.8)', color: '#fff' }}>
      ⚠
    </span>
  );
}

function GridLine({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="absolute right-0 top-0 w-px h-full bg-white/15 z-10 pointer-events-none" />;
}

function DayCell({ day, di, viewDate, today, activeProperties, eventsByProp }: {
  day: Date; di: number; viewDate: Date; today: string;
  activeProperties: Property[]; eventsByProp: Map<string, ProcessedEvent[]>;
}) {
  const dateStr = toDateStr(day);
  const isThisMonth = day.getMonth() === viewDate.getMonth();
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const weekendBg = di === 0 ? 'bg-red-500/[0.03]' : di === 6 ? 'bg-blue-500/[0.03]' : '';
  const avail = isThisMonth && activeProperties.length > 0 ? getDayAvailability(dateStr, activeProperties, eventsByProp) : null;
  const allAvailable = avail && avail.available === avail.total && avail.total > 0;
  const noneAvailable = avail && avail.available === 0 && avail.total > 0;

  return (
    <div className={`py-2 px-2 flex items-center justify-between ${!isThisMonth ? 'opacity-20' : ''} ${isToday ? 'bg-white/[0.05]' : weekendBg} ${di < 6 ? 'border-r border-white/15' : ''}`}>
      <div className="w-4 flex justify-center">
        {avail && !isPast && isThisMonth && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              allAvailable ? 'bg-emerald-400/80' :
              noneAvailable ? 'bg-red-400/50' :
              'bg-amber-400/60'
            }`}
            title={`${avail.available}/${avail.total} 숙소 예약 가능`}
          />
        )}
      </div>
      <span className={`text-xs inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
        isToday ? 'bg-white text-black font-semibold' :
        di === 0 ? 'text-red-400/80' :
        di === 6 ? 'text-blue-400/70' :
        'text-white/40 font-light'
      }`}>
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
  const bgEmpty = hexToRgba(prop.color, 0.04);
  const weekendBg = di === 0 ? 'rgba(239,68,68,0.02)' : di === 6 ? 'rgba(59,130,246,0.02)' : undefined;
  const emptyBg = weekendBg || bgEmpty;
  const showGridLine = di < 6;

  // Mid-stay
  if (midEvent) {
    const showLabel = di === 0 && midEvent.start < weekStartStr;
    return (
      <div className="relative h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
        onClick={() => openModal(midEvent)}
        style={{ backgroundColor: midEvent.color }}
      >
        {showLabel && (
          <span className="px-2 text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
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
      <div className="relative h-full flex" style={{ gap: '2px' }}>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkoutEvent)}
          style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0', opacity: 0.75,
            outline: !checkoutEvent.cleanerId ? '1.5px dashed rgba(245,158,11,0.6)' : 'none', outlineOffset: '-1.5px' }}
        >
          <CleanBadge evt={checkoutEvent} />
        </div>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkinEvent)}
          style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
        >
          <span className="px-1 text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
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
      <div className="relative h-full flex items-center" style={{ backgroundColor: emptyBg }}>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkoutEvent)}
          style={{ width: '50%', backgroundColor: checkoutEvent.color, borderRadius: '0 6px 6px 0', opacity: 0.75,
            outline: !checkoutEvent.cleanerId ? '1.5px dashed rgba(245,158,11,0.6)' : 'none', outlineOffset: '-1.5px' }}
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
      <div className="relative h-full flex items-center justify-end" style={{ backgroundColor: emptyBg }}>
        <div className="h-full cursor-pointer hover:brightness-110 transition-all flex items-center overflow-hidden"
          onClick={() => openModal(checkinEvent)}
          style={{ width: '50%', backgroundColor: checkinEvent.color, borderRadius: '6px 0 0 6px' }}
        >
          <span className="px-1.5 text-[10px] font-semibold text-white truncate leading-none drop-shadow-sm">
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
    <div className="relative h-full flex items-center justify-center" style={{ backgroundColor: emptyBg }}>
      {!dayIsPast && day.getMonth() === viewDate.getMonth() && (
        <span className="w-1 h-1 rounded-full bg-emerald-500/25" />
      )}
      <GridLine show={showGridLine} />
    </div>
  );
}

export function CalendarGrid({ weeks, viewDate, today, activeProperties, eventsByProp, openModal }: CalendarGridProps) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden min-w-[480px] mx-4 md:mx-0">
        {/* Day of week header */}
        <div className="grid grid-cols-7 border-b border-white/10">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className={`py-3 text-center text-[11px] tracking-widest font-semibold ${i === 0 ? 'text-red-400/70' : i === 6 ? 'text-blue-400/70' : 'text-white/40'} ${i < 6 ? 'border-r border-white/15' : ''}`}>
              {label}
            </div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className={wi < weeks.length - 1 ? 'border-b border-white/[0.08]' : ''}>
            <div className="grid grid-cols-7 border-b border-white/[0.06]">
              {week.map((day, di) => (
                <DayCell key={di} day={day} di={di} viewDate={viewDate} today={today}
                  activeProperties={activeProperties} eventsByProp={eventsByProp} />
              ))}
            </div>

            {activeProperties.length > 0 && (
              <div className="space-y-0">
                {activeProperties.map((prop) => {
                  const weekStartStr = toDateStr(week[0]);
                  return (
                    <div key={prop.id} className="grid grid-cols-7" style={{ height: '32px' }}>
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
