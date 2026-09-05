import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
    const exportUrl = `/api/export/${channelId}`;

    // Find channel by export URL
    const channel = await prisma.propertyChannel.findFirst({
      where: { exportUrl },
    });

    if (!channel) {
      return new NextResponse('Channel not found', { status: 404 });
    }

    const foundPropId = channel.propertyId;
    const foundChannelName = channel.name;

    // Fetch all events for this property
    const events = await prisma.event.findMany({
      where: { propertyId: foundPropId },
    });

    // Fetch confirmed direct bookings
    const bookings = await prisma.booking.findMany({
      where: { propertyId: foundPropId, status: 'confirmed' },
    });

    // Build ICS events
    const icsEvents: ics.EventAttributes[] = [
      // description 은 내보내지 않는다 — 게스트 이메일·연락처가 다른 채널로 흘러간다.
      ...events.map((e, i) => ({
        uid: e.id || `event-${i}`,
        title: e.title || undefined,
        start: dateToIcsTuple(e.startDate),
        end: dateToIcsTuple(e.endDate),
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
