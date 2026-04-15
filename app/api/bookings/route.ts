import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const propertyIds = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const status = searchParams.get('status');
    const limit = Math.min(Number(searchParams.get('limit')) || 500, 1000);
    const offset = Number(searchParams.get('offset')) || 0;

    const where: Record<string, unknown> = {};
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (status) where.status = status;

    const bookings = await prisma.booking.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
    });
    return NextResponse.json(bookings);
  } catch (e) {
    console.error('[bookings] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.propertyId || !body.checkIn || !body.checkOut) {
      return NextResponse.json({ error: 'propertyId, checkIn, checkOut은 필수입니다.' }, { status: 400 });
    }

    const booking = await prisma.booking.create({ data: body });
    return NextResponse.json(booking, { status: 201 });
  } catch (e) {
    console.error('[bookings] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const booking = await prisma.booking.update({ where: { id }, data });
    return NextResponse.json(booking);
  } catch (e) {
    console.error('[bookings] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    await prisma.booking.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[bookings] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
