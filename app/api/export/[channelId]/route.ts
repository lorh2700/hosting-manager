import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import * as ics from 'ics';
import { parseISO } from 'date-fns';

function dateToIcsTuple(dateStr: string): ics.DateArray {
  const isAllDay = dateStr.length === 10;
  const d = parseISO(dateStr);
  if (isAllDay) {
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  }
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;

  if (!channelId) {
    return new NextResponse('Channel ID is required', { status: 400 });
  }

  try {
    // 1. Find channel by exportUrl field (stored as /api/export/{token}.ics)
    const exportUrl = `/api/export/${channelId}`;
    const channelSnap = await getDocs(query(collection(db, 'channels'), where('exportUrl', '==', exportUrl)));

    if (channelSnap.empty) {
      return new NextResponse('Channel not found', { status: 404 });
    }

    const channelDoc = channelSnap.docs[0];
    const channel = channelDoc.data() as {
      propertyId: string;
      name: string;
    };

    // 2. Fetch all events for this property
    const eventsSnap = await getDocs(
      query(collection(db, 'events'), where('propertyId', '==', channel.propertyId))
    );
    const channelEvents = eventsSnap.docs.map(d => d.data() as {
      id?: string;
      title: string;
      start: string;
      end: string;
      type: string;
      description?: string;
    });

    // 3. Fetch confirmed direct bookings
    const bookingsSnap = await getDocs(
      query(
        collection(db, 'bookings'),
        where('propertyId', '==', channel.propertyId),
        where('status', '==', 'confirmed'),
      )
    );
    const bookings = bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as {
      id: string;
      name: string;
      checkIn: string;
      checkOut: string;
    }));

    // 4. Build ICS events
    const icsEvents: ics.EventAttributes[] = [
      ...channelEvents.map((e, i) => ({
        uid: e.id || `event-${i}`,
        title: e.title,
        description: e.description,
        start: dateToIcsTuple(e.start),
        end: dateToIcsTuple(e.end),
      })),
      ...bookings.map(b => ({
        uid: b.id,
        title: `${b.name} (직접예약)`,
        start: dateToIcsTuple(b.checkIn),
        end: dateToIcsTuple(b.checkOut),
      })),
    ];

    if (icsEvents.length === 0) {
      const emptyCal = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//void anchae//EN',
        'CALSCALE:GREGORIAN',
        'END:VCALENDAR',
      ].join('\r\n');
      return new NextResponse(emptyCal, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `attachment; filename="${channel.name}.ics"`,
        },
      });
    }

    const { error, value } = ics.createEvents(icsEvents);
    if (error || !value) {
      console.error('ICS generation error:', error);
      return new NextResponse('Error generating calendar', { status: 500 });
    }

    return new NextResponse(value, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${channel.name}.ics"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
