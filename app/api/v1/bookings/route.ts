import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient, propertyScopeFilter } from '@/lib/api-auth';
import {
  bookingsQuerySchema,
  serializeEventAsBooking,
  serializeBookingRow,
  zodIssuesToDetails,
} from '@/lib/v1-schemas';

// GET /api/v1/bookings
// Scope: bookings:read
// Query: ?propertyId=&from=YYYY-MM-DD&to=YYYY-MM-DD&status=&source=&limit=
//
// Event (OTA mirror) + Booking (direct) 통합 응답. 같은 reservation 이 두 테이블에
// 동시에 있을 일은 거의 없지만, 정렬은 checkIn 기준.
//
// ApiClient.propertyIds 가 set 이면 그 지점에 자동 제한.

const EVENT_STATUS_TYPE_FILTER: Record<string, Record<string, unknown>> = {
  confirmed: { type: 'reservation' },
  inquiry:   { type: 'reservation', tags: { has: 'inquiry' } },
  cancelled: { type: 'block' },
  // 'pending' 은 Event 에 직접 매핑 없음 — Booking 테이블에만 적용
};

export async function GET(req: Request) {
  const auth = await requireApiClient(req, { scope: 'bookings:read' });
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const parsed = bookingsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BadRequest', code: 'invalid_query', details: zodIssuesToDetails(parsed.error) },
      { status: 400 },
    );
  }
  const q = parsed.data;

  // 지점 범위: 인증 client 의 propertyIds ∩ query propertyId
  const clientScope = propertyScopeFilter(auth);
  const propertyFilter = q.propertyId
    ? clientScope.propertyId
      ? { propertyId: { in: clientScope.propertyId.in.filter((id) => id === q.propertyId) } }
      : { propertyId: q.propertyId }
    : clientScope;

  // events 필터: type/tags 는 status 별 처리, 날짜는 overlap (start <= to AND end >= from)
  const eventStatusFilter = q.status ? EVENT_STATUS_TYPE_FILTER[q.status] ?? {} : {};
  const eventDateFilter =
    q.from || q.to
      ? {
          startDate: q.to ? { lte: q.to } : undefined,
          endDate: q.from ? { gte: q.from } : undefined,
        }
      : {};

  // source 필터 — Event 는 channelId 또는 source 컬럼에서 매칭
  const eventSourceFilter = q.source
    ? { OR: [{ channelId: q.source }, { source: { contains: q.source } }] }
    : {};

  const events = await prisma.event.findMany({
    where: {
      ...propertyFilter,
      ...eventStatusFilter,
      ...eventDateFilter,
      ...eventSourceFilter,
    },
    select: {
      id: true, propertyId: true, channelId: true, source: true,
      title: true, startDate: true, endDate: true, type: true,
      originalUid: true, tags: true,
      guestEmail: true, guestPhone: true, numAdults: true, numChildren: true,
      createdAt: true,
    },
    orderBy: { startDate: 'asc' },
    take: q.limit,
  });

  // Booking 테이블 (direct/현장 예약). source 필터가 'direct' 이거나 미지정이면 포함.
  let bookings: Awaited<ReturnType<typeof prisma.booking.findMany>> = [];
  const includeDirect = !q.source || q.source === 'direct';
  if (includeDirect) {
    const bookingStatusMap: Record<string, string> = {
      confirmed: 'confirmed',
      cancelled: 'cancelled',
      pending: 'pending',
    };
    const bookingStatusFilter = q.status && bookingStatusMap[q.status]
      ? { status: bookingStatusMap[q.status] }
      : q.status === 'inquiry' ? { id: '__none__' }  // direct booking 엔 inquiry 가 없음
      : {};
    const bookingDateFilter =
      q.from || q.to
        ? {
            checkIn: q.to ? { lte: q.to } : undefined,
            checkOut: q.from ? { gte: q.from } : undefined,
          }
        : {};
    bookings = await prisma.booking.findMany({
      where: {
        ...propertyFilter,
        ...bookingStatusFilter,
        ...bookingDateFilter,
      },
      orderBy: { checkIn: 'asc' },
      take: q.limit,
    });
  }

  const items = [
    ...events.map(serializeEventAsBooking),
    ...bookings.map(serializeBookingRow),
  ]
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    .slice(0, q.limit);

  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } },
  );
}
