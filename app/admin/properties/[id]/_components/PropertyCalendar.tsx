'use client';

import { useState } from 'react';
import MobileBookingCalendar from '@/components/MobileBookingCalendar';
import { todayKst } from '@/lib/dates';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor: string;
  borderColor: string;
  extendedProps: {
    type: 'reservation' | 'block';
    channelName: string;
  channelId: string;
    eventId: string;
    description?: string;
    source?: string;
  };
}

export interface PropertyCalendarSelected {
  title: string;
  start: Date | null;
  end: Date | null;
  type: 'reservation' | 'block';
  channelName: string;
  channelId: string;
  description?: string;
  color: string;
  eventId: string;
  source?: string;
}

interface Props {
  events: CalendarEvent[];
  onEventClick: (event: PropertyCalendarSelected) => void;
}

function blockLabel(source?: string) {
  return source === 'maintenance' ? '정비' : '차단';
}

export default function PropertyCalendar({ events, onEventClick }: Props) {
  const [month, setMonth] = useState(() => new Date(`${todayKst()}T12:00:00`));
  return (<>
    <div className="space-y-4 md:hidden">
      <div className="flex items-center justify-between gap-2">
        <button aria-label="이전 달" className="min-h-11 min-w-11 rounded-xl bg-stone-100" onClick={() => setMonth(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}>‹</button>
        <h2 className="font-semibold">{month.getFullYear()}년 {month.getMonth()+1}월</h2>
        <button aria-label="다음 달" className="min-h-11 min-w-11 rounded-xl bg-stone-100" onClick={() => setMonth(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}>›</button>
        <button className="min-h-11 rounded-xl bg-stone-100 px-3 text-sm" onClick={() => setMonth(new Date(`${todayKst()}T12:00:00`))}>오늘</button>
      </div>
      <MobileBookingCalendar key={month.getTime()} month={month} today={todayKst()}
        events={events.map(e => ({ id:e.id, title:e.title, start:e.start.slice(0,10), end:e.end.slice(0,10), type:e.extendedProps.type }))}
        onEventClick={id => { const e=events.find(e => e.id===id); if(e) onEventClick({ title:e.title, start:new Date(e.start), end:new Date(e.end), type:e.extendedProps.type, channelName:e.extendedProps.channelName, channelId:e.extendedProps.channelId, description:e.extendedProps.description, color:e.backgroundColor, eventId:e.extendedProps.eventId, source:e.extendedProps.source }); }} />
    </div>
    <div className="hidden md:block"><FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek',
      }}
      buttonText={{
        today: '오늘',
        month: '월',
        week: '주',
        day: '일',
        list: '목록',
      }}
      locales={[koLocale]}
      locale="ko"
      events={events}
      height="auto"
      eventClick={(info) => {
        onEventClick({
          title: info.event.title,
          start: info.event.start,
          end: info.event.end,
          type: info.event.extendedProps.type,
          channelName: info.event.extendedProps.channelName,
          channelId: info.event.extendedProps.channelId,
          description: info.event.extendedProps.description,
          color: info.event.backgroundColor,
          eventId: info.event.extendedProps.eventId,
          source: info.event.extendedProps.source,
        });
      }}
      eventContent={(eventInfo) => (
        <div className="p-1.5 overflow-hidden text-[12px] tracking-wider truncate">
          <div className="font-semibold">{eventInfo.event.title}</div>
          <div className="opacity-70 font-light">
            {eventInfo.event.extendedProps.type === 'block'
              ? blockLabel(eventInfo.event.extendedProps.source)
              : '예약'}
          </div>
        </div>
      )}
    /></div>
  </>);
}
