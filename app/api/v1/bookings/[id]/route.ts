import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient, propertyScopeFilter } from '@/lib/api-auth';
import { serializeEventAsBooking, serializeBookingRow } from '@/lib/v1-schemas';
import { withErrors } from '@/lib/core/http';

// GET /api/v1/bookings/{id} — Scope: bookings:read. ID 는 Event.id 또는 Booking.id (둘 다 UUID).
export const GET = withErrors<{ id: string }>('v1/bookings/id', async (req, { params }) => {
  const auth = await requireApiClient(req, { scope: 'bookings:read' });
  if (auth instanceof Response) return auth;

  const scope = propertyScopeFilter(auth);
  const ev = await prisma.event.findFirst({
    where: { id: params.id, ...scope },
    select: {
      id: true, propertyId: true, channelId: true, source: true, title: true, startDate: true, endDate: true, type: true,
      originalUid: true, tags: true, guestEmail: true, guestPhone: true, numAdults: true, numChildren: true, createdAt: true,
    },
  });
  if (ev) return NextResponse.json(serializeEventAsBooking(ev));

  const bk = await prisma.booking.findFirst({ where: { id: params.id, ...scope } });
  if (bk) return NextResponse.json(serializeBookingRow(bk));

  return NextResponse.json({ error: 'NotFound', code: 'booking_not_found' }, { status: 404 });
});
