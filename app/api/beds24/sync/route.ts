import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBeds24Token, BEDS24_BASE_URL, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';

export async function POST(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN is not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { propertyId, beds24PropId } = body;

  if (!propertyId || !beds24PropId) {
    return NextResponse.json({ error: 'propertyId and beds24PropId are required' }, { status: 400 });
  }

  try {
    const token = await getBeds24Token();

    const today = new Date();
    const from = new Date(today);
    from.setMonth(from.getMonth() - 1);
    const to = new Date(today);
    to.setFullYear(to.getFullYear() + 1);

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    let allBookings: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        propertyId: String(beds24PropId),
        departureFrom: fromStr,
        departureTo: toStr,
        page: String(page),
      });

      const response = await fetch(`${BEDS24_BASE_URL}/bookings?${params}`, {
        headers: { 'token': token },
      });

      if (!response.ok) {
        const errText = await response.text();
        return NextResponse.json(
          { error: `Beds24 API 오류: ${response.status} ${errText}` },
          { status: 502 }
        );
      }

      const data = await response.json();
      const bookings: Record<string, unknown>[] = data.data || [];
      allBookings = allBookings.concat(bookings);

      if (data.pages?.nextPageExists && bookings.length > 0) {
        page++;
      } else {
        hasMore = false;
      }
    }

    // Convert Beds24 bookings to events
    const newEvents = allBookings
      .filter((b) => b.status !== 'cancelled' && b.arrival && b.departure)
      .map((b) => {
        const guestName = [b.firstName, b.lastName].filter(Boolean).join(' ') || '게��트';
        const channelSource = (b.channel as string) || (b.referer as string) || 'Beds24';

        const descriptionParts = [
          `게스트: ${guestName}`,
          b.email ? `이메일: ${b.email}` : '',
          b.phone ? `연락처: ${b.phone}` : '',
          `인원: 성인 ${b.numAdult || 0}명${b.numChild ? `, 아동 ${b.numChild}명` : ''}`,
          `채널: ${channelSource}`,
          b.price ? `금액: ₩${Number(b.price).toLocaleString()}` : '',
          b.notes ? `메모: ${b.notes}` : '',
        ].filter(Boolean).join('\n');

        return {
          propertyId,
          channelId: 'beds24',
          source: channelSource,
          title: guestName as string,
          startDate: (b.arrival as string).substring(0, 10),
          endDate: (b.departure as string).substring(0, 10),
          type: 'reservation' as const,
          originalUid: String(b.id),
          description: descriptionParts,
        };
      });

    const incomingUids = new Set(newEvents.map(e => e.originalUid));
    let eventsCreated = 0;
    let eventsUpdated = 0;

    for (const event of newEvents) {
      const existing = await prisma.event.findFirst({
        where: { propertyId, channelId: 'beds24', originalUid: event.originalUid },
      });

      if (!existing) {
        await prisma.event.create({ data: event });
        eventsCreated++;
      } else if (existing.startDate !== event.startDate || existing.endDate !== event.endDate || existing.title !== event.title) {
        await prisma.event.update({
          where: { id: existing.id },
          data: { startDate: event.startDate, endDate: event.endDate, title: event.title, description: event.description, source: event.source },
        });
        eventsUpdated++;
      }
    }

    // Remove events that no longer exist in Beds24
    let eventsRemoved = 0;
    const existingEvents = await prisma.event.findMany({
      where: { propertyId, channelId: 'beds24' },
    });

    for (const existing of existingEvents) {
      if (existing.originalUid && !incomingUids.has(existing.originalUid)) {
        await prisma.event.delete({ where: { id: existing.id } });
        eventsRemoved++;
      }
    }

    return NextResponse.json({
      success: true,
      total: newEvents.length,
      eventsCreated,
      eventsUpdated,
      eventsRemoved,
    });
  } catch (error) {
    console.error('Beds24 sync error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
