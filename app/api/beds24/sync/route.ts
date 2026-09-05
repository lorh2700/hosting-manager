import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncBeds24Property } from '@/lib/sync-engine';
import { getSessionWithUser, canManageProperty } from '@/lib/auth';

/**
 * 숙소 한 곳의 Beds24 동기화 (숙소 페이지의 동기화 버튼).
 * beds24PropId 는 body 가 아니라 DB 의 숙소 설정에서 가져온다 — 임의의 Beds24
 * 숙소 예약을 다른 숙소에 흘려 넣는 것을 막기 위해서.
 */
export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null;
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }
    if (!canManageProperty(auth, propertyId)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { beds24PropId: true },
    });
    if (!property) return NextResponse.json({ error: '숙소를 찾을 수 없습니다.' }, { status: 404 });
    if (!property.beds24PropId) {
      return NextResponse.json({ error: '이 숙소에는 Beds24 연동이 설정되어 있지 않습니다.' }, { status: 400 });
    }

    const result = await syncBeds24Property(propertyId, property.beds24PropId);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      total: result.total,
      eventsCreated: result.eventsCreated,
      eventsUpdated: result.eventsUpdated,
      eventsRemoved: result.eventsRemoved,
    });
  } catch (error) {
    console.error('Beds24 sync error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
