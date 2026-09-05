'use client';

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
  return (
    <FullCalendar
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
    />
  );
}
