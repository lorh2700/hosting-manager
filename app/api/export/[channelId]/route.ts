import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
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
    const db = getAdminDb();

    // 1. Find channel by scanning all properties' embedded channels map
    const exportUrl = `/api/export/${channelId}`;
    const propsSnap = await db.collection('properties').get();
    let foundPropId: string | null = null;
    let foundChannelName: string | null = null;

    for (const propDoc of propsSnap.docs) {
      const channels = (propDoc.data().channels ?? {}) as Record<string, { exportUrl?: string }>;
      for (const [name, ch] of Object.entries(channels)) {
        if (ch.exportUrl === exportUrl) {
          foundPropId = propDoc.id;
          foundChannelName = name;
          break;
        }
      }
      if (foundPropId) break;
    }

    if (!foundPropId) {
      return new NextResponse('Channel not found', { status: 404 });
    }

    // 2. Fetch all events for this property
    const eventsSnap = await db.collection('events').where('propertyId', '==', foundPropId).get();
    const channelEvents = eventsSnap.docs.map(d => d.data() as {
      id?: string;
      title: string;
      start: string;
      end: string;
      type: string;
      description?: string;
    });

    // 3. Fetch confirmed direct bookings
    const bookingsSnap = await db.collection('bookings')
      .where('propertyId', '==', foundPropId)
      .where('status', '==', 'confirmed')
      .get();
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
          'Content-Disposition': `attachment; filename="${foundChannelName}.ics"`,
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
        'Content-Disposition': `attachment; filename="${foundChannelName}.ics"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
