import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { properties: true },
  });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = ['super_admin', 'admin'].includes(user.role);
  const properties = isAdmin
    ? await prisma.property.findMany({ orderBy: { createdAt: 'desc' } })
    : await prisma.property.findMany({
        where: { id: { in: user.properties.map(p => p.propertyId) } },
        orderBy: { createdAt: 'desc' },
      });

  return NextResponse.json(properties);
}

export async function POST(req: Request) {
  const session = await verifySession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const property = await prisma.property.create({
    data: {
      name: body.name,
      timezone: body.timezone || 'Asia/Seoul',
      ownerId: session.userId,
      beds24PropId: body.beds24PropId,
      doorPassword: body.doorPassword,
      addressUrl: body.addressUrl,
      roomReadyMessage: body.roomReadyMessage,
      basePrice: body.basePrice,
      maxGuests: body.maxGuests,
      description: body.description,
    },
  });

  // Link owner
  await prisma.userProperty.create({
    data: { userId: session.userId, propertyId: property.id },
  });

  return NextResponse.json(property, { status: 201 });
}
