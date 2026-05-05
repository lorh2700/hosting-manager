import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession, getSessionWithUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (auth.isAdmin) {
      const properties = await prisma.property.findMany({ orderBy: { createdAt: 'desc' } });
      return NextResponse.json(properties);
    }

    // Resolve a Cleaner record using userId, then phone. Treat the user as
    // a cleaner if EITHER role='cleaner' OR a Cleaner row exists — handles
    // the case where role is mis-set on legacy accounts.
    let myCleaner = await prisma.cleaner.findUnique({
      where: { userId: auth.session.userId },
      select: { ownerId: true },
    });
    if (!myCleaner && auth.user.phone) {
      myCleaner = await prisma.cleaner.findFirst({
        where: { phone: auth.user.phone },
        select: { ownerId: true },
      });
    }
    const isCleaner = auth.user.role === 'cleaner' || !!myCleaner;

    if (isCleaner) {
      const userPropScope = auth.propertyIds ?? [];

      if (myCleaner) {
        // Primary: every property of the cleaner's host.
        const ownerProps = await prisma.property.findMany({
          where: { ownerId: myCleaner.ownerId },
          orderBy: { createdAt: 'desc' },
        });
        if (ownerProps.length > 0) {
          return NextResponse.json(ownerProps);
        }
        // Fallback: Cleaner.ownerId points to a host with no properties
        // (data inconsistency — the cleaner was registered under one
        // host but actually services properties owned by another). Fall
        // back to the UserProperty scope which the admin actually wired.
        if (userPropScope.length > 0) {
          const properties = await prisma.property.findMany({
            where: { id: { in: userPropScope } },
            orderBy: { createdAt: 'desc' },
          });
          return NextResponse.json(properties);
        }
      }
      // No Cleaner row at all and no scope → last-resort: all properties
      // so the cleaner-side pages have something to work with.
      if (userPropScope.length > 0) {
        const properties = await prisma.property.findMany({
          where: { id: { in: userPropScope } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(properties);
      }
      const properties = await prisma.property.findMany({ orderBy: { createdAt: 'desc' } });
      return NextResponse.json(properties);
    }

    const scopedIds = auth.propertyIds ?? [];
    if (scopedIds.length === 0) return NextResponse.json([]);
    const properties = await prisma.property.findMany({
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
