import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPropertyDisplay, propertyImagePaths, slugCandidates } from '@/lib/property-display';

// GET /api/public/properties/{idOrSlug}
//
// idOrSlug 는 UUID (기존 방식) 또는 slug (새로 노출되는 pretty URL) 둘 다 지원.
// coming_soon 상태 지점은 bookedDates 를 빈 배열로 두고 status 필드로 UI 가 판단.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const key = raw.trim();

  try {
    // slugCandidates — 리네임된 지점은 구/신 슬러그 양쪽으로 찾는다.
    // (DB 마이그레이션이 아직 안 돌았어도 새 URL 이 살아있게)
    const property = await prisma.property.findFirst({
      where: UUID_REGEX.test(key) ? { id: key } : { slug: { in: slugCandidates(key) } },
    });
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // 표시 메타 (사진, 지역, 캐치프레이즈 등) — code-side 매핑
    const display = property.slug ? getPropertyDisplay(property.slug) : null;
    const images = display ? propertyImagePaths(display).map((p) => p.src) : [];
    const imageUrl = images[0] ?? null;

    // coming_soon 이면 예약 데이터 조회 스킵 (캘린더 비활성이므로 불필요)
    const isBookable = property.status === 'active';
    let bookedDates: { start: string; end: string; type: string }[] = [];
    if (isBookable) {
      const [events, bookings] = await Promise.all([
        prisma.event.findMany({
          where: { propertyId: property.id },
          select: { startDate: true, endDate: true, type: true },
        }),
        prisma.booking.findMany({
          where: { propertyId: property.id, status: 'confirmed' },
          select: { checkIn: true, checkOut: true },
        }),
      ]);
      bookedDates = [
        ...events.map((e) => ({ start: e.startDate, end: e.endDate, type: e.type })),
        ...bookings.map((b) => ({ start: b.checkIn, end: b.checkOut, type: 'reservation' })),
      ];
    }

    return NextResponse.json({
      id: property.id,
      slug: property.slug,
      status: property.status,
      openingDate: property.openingDate,
      name: property.name,
      timezone: property.timezone,
      permit: null,
      imageUrl,
      images,
      description: property.description ?? null,
      checkInTime: display?.checkInTime ?? null,
      checkOutTime: display?.checkOutTime ?? null,
      maxGuests: property.maxGuests ?? null,
      region: display?.region ?? null,
      addressKo: display?.addressKo ?? null,
      catchphrase: display?.catchphrase ?? null,
      bookedDates,
    });
  } catch (error) {
    console.error('Failed to fetch property:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
