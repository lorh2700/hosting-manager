import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession, getSessionWithUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isCleaner = auth.user.role === 'cleaner';
    const scopedIds = auth.propertyIds ?? [];
    // Cleaner with no explicit scope → sees every property (backwards compat).
    // Cleaner with scope → restricted to those properties.
    const cleanerUnrestricted = isCleaner && scopedIds.length === 0;

    const properties = auth.isAdmin || cleanerUnrestricted
      ? await prisma.property.findMany({ orderBy: { createdAt: 'desc' } })
      : await prisma.property.findMany({
          where: { id: { in: scopedIds } },
          orderBy: { createdAt: 'desc' },
        });

    return NextResponse.json(properties);
  } catch (e) {
    console.error('[properties] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.name) {
      return NextResponse.json({ error: 'name은 필수입니다.' }, { status: 400 });
    }

    const property = await prisma.property.create({
      data: {
        name: body.name,
        timezone: body.timezone || 'Asia/Seoul',
        ownerId: session.userId,
        beds24PropId: body.beds24PropId,
        beds24RoomId: body.beds24RoomId,
        doorPassword: body.doorPassword,
        addressUrl: body.addressUrl,
        roomReadyMessage: body.roomReadyMessage,
        basePrice: body.basePrice,
        maxGuests: body.maxGuests,
        description: body.description,
      },
    });

    await prisma.userProperty.create({
      data: { userId: session.userId, propertyId: property.id },
    });

    return NextResponse.json(property, { status: 201 });
  } catch (e) {
    console.error('[properties] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
