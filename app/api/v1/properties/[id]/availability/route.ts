import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient } from '@/lib/api-auth';
import {
  availabilityQuerySchema,
  zodIssuesToDetails,
  type AvailabilityDay,
} from '@/lib/v1-schemas';

// GET /api/v1/properties/{id}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Scope: properties:read
//
// 해당 지점의 [from, to] 구간 일자별 가용 여부.
// "이용 중" 정의: confirmed reservation (Event reservation 또는 Booking confirmed)
// 이 같은 일자에 걸쳐 있음. inquiry 는 차단으로 간주하지 않음 (보수적으로 가용으로 노출).
//
// from 포함 ~ to 미포함 (hotel night convention: check-in ≤ date < check-out 일 때 점유).

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiClient(req, { scope: 'properties:read' });
  if (auth instanceof Response) return auth;

  const { id: propertyId } = await ctx.params;

  // ApiClient.propertyIds 제한 확인
  if (auth.propertyIds.length > 0 && !auth.propertyIds.includes(propertyId)) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'property_out_of_scope' },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const parsed = availabilityQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BadRequest', code: 'invalid_query', details: zodIssuesToDetails(parsed.error) },
      { status: 400 },
    );
  }
  const { from, to } = parsed.data;

  // 구간 안에 한쪽 끝이라도 걸친 confirmed reservation 모두 가져오기.
  // Event 와 Booking 둘 다.
  const [events, bookings, property] = await Promise.all([
    prisma.event.findMany({
      where: {
        propertyId,
        type: 'reservation',
        NOT: { tags: { has: 'inquiry' } },
        startDate: { lt: to },     // start < to (구간 안에 시작 또는 그 전 시작)
        endDate: { gt: from },     // end > from (구간 안에 끝나거나 그 후 끝남)
      },
      select: { id: true, startDate: true, endDate: true, originalUid: true },
    }),
    prisma.booking.findMany({
      where: {
        propertyId,
        status: 'confirmed',
        checkIn: { lt: to },
        checkOut: { gt: from },
      },
      select: { id: true, checkIn: true, checkOut: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } }),
  ]);

  if (!property) {
    return NextResponse.json(
      { error: 'NotFound', code: 'property_not_found' },
      { status: 404 },
    );
  }

  // 일자별 점유 맵 만들기. 점유 = check-in ≤ date < check-out.
  const occupiedBy: Record<string, string> = {};  // date → bookingId
  const claim = (start: string, end: string, bookingId: string) => {
    const d = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    while (d < endDate) {
      const key = d.toISOString().slice(0, 10);
      if (key >= from && key < to && !occupiedBy[key]) occupiedBy[key] = bookingId;
      d.setUTCDate(d.getUTCDate() + 1);
    }
  };
  for (const e of events) claim(e.startDate, e.endDate, e.id);
  for (const b of bookings) claim(b.checkIn, b.checkOut, b.id);

  // 응답 — from 포함 to 미포함 일자 전부 enumerate
  const days: AvailabilityDay[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const endDate = new Date(`${to}T00:00:00Z`);
  while (cursor < endDate) {
    const date = cursor.toISOString().slice(0, 10);
    const bookingId = occupiedBy[date] ?? null;
    days.push({ date, available: !bookingId, bookingId });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return NextResponse.json(
    { propertyId, from, to, days },
    { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' } },
  );
}
