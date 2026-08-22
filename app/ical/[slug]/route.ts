import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { slugCandidates } from '@/lib/property-display';

// /ical/{slug} 동적 fallback — netlify.toml 에 항목이 없는 슬러그도 자동 처리.
//
// netlify.toml 의 [[redirects]] 는 edge 에서 먼저 적용되므로 거기 등록된 슬러그
// (anon, anonjae, unwadang, hwayeonjae, byulha) 는 이 라우트까지 오지 않고
// 곧장 Beds24 로 리다이렉트된다. 새 지점을 추가할 때 netlify.toml 을 잊더라도
// 이 fallback 이 DB Property.beds24RoomId 를 조회해서 리다이렉트해 준다.
//
// slugCandidates 로 구/신 슬러그 (예: byeolha → byulha) 를 모두 받아준다.

const BEDS24_ICAL_BASE = 'https://api.beds24.com/ical/bookings.ics';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;
  const slug = (rawSlug || '').trim().toLowerCase();
  if (!slug) return new NextResponse('slug is required', { status: 400 });

  const property = await prisma.property.findFirst({
    where: { slug: { in: slugCandidates(slug) } },
    select: { name: true, beds24RoomId: true },
  });

  if (!property) return new NextResponse('Property not found', { status: 404 });
  if (!property.beds24RoomId) {
    return new NextResponse(`iCal not configured for ${property.name} (missing beds24RoomId)`, { status: 404 });
  }

  const target = `${BEDS24_ICAL_BASE}?roomid=${encodeURIComponent(property.beds24RoomId)}`;
  return NextResponse.redirect(target, 301);
}
