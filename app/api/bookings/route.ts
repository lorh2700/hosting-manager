import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty, getVisiblePropertyIds } from '@/lib/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['pending', 'confirmed', 'cancelled'];

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

// body 를 그대로 Prisma 에 넘기지 않는다 — 허용 필드만 골라 담는다.
// (예: 화면이 보내는 cancelledAt 은 Booking 컬럼이 아니라 이전에는 500 을 냈다.)
function pickBookingFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 100);
  if (typeof body.email === 'string') data.email = body.email.trim().slice(0, 200);
  if (typeof body.phone === 'string') data.phone = body.phone.trim().slice(0, 40);
  if (body.guests !== undefined && Number.isFinite(Number(body.guests))) {
    data.guests = Math.max(1, Math.min(50, Number(body.guests)));
  }
  if (typeof body.checkIn === 'string' && DATE_RE.test(body.checkIn)) data.checkIn = body.checkIn;
  if (typeof body.checkOut === 'string' && DATE_RE.test(body.checkOut)) data.checkOut = body.checkOut;
  if (typeof body.status === 'string' && STATUSES.includes(body.status)) data.status = body.status;
  if (typeof body.message === 'string') data.message = body.message.slice(0, 2000);
  if (typeof body.source === 'string') data.source = body.source.slice(0, 50);
  if (typeof body.channelBookingRef === 'string' || body.channelBookingRef === null) {
    data.channelBookingRef = body.channelBookingRef ? String(body.channelBookingRef).slice(0, 100) : null;
  }
  return data;
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const requested = searchParams.get('propertyIds')?.split(',').filter(Boolean);
    const status = searchParams.get('status');
    const limit = Math.min(Number(searchParams.get('limit')) || 500, 1000);
    const offset = Number(searchParams.get('offset')) || 0;

    const where: Record<string, unknown> = {};
    const visible = await getVisiblePropertyIds(auth, requested);
    if (visible !== null) {
      if (visible.length === 0) return NextResponse.json([]);
      where.propertyId = { in: visible };
    }
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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null;
    const data = pickBookingFields(body);
    if (!propertyId || typeof data.checkIn !== 'string' || typeof data.checkOut !== 'string') {
      return NextResponse.json({ error: 'propertyId, checkIn, checkOut은 필수입니다.' }, { status: 400 });
    }
    if (data.checkIn >= data.checkOut) {
      return NextResponse.json({ error: '체크아웃은 체크인보다 뒤여야 합니다.' }, { status: 400 });
    }
    if (!canManageProperty(auth, propertyId)) return forbidden();

    const booking = await prisma.booking.create({
      data: {
        propertyId,
        name: (data.name as string | undefined) ?? null,
        email: (data.email as string | undefined) ?? null,
        phone: (data.phone as string | undefined) ?? null,
        guests: (data.guests as number | undefined) ?? 1,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        status: (data.status as string | undefined) ?? 'pending',
        message: (data.message as string | undefined) ?? null,
        source: (data.source as string | undefined) ?? 'direct',
        channelBookingRef: (data.channelBookingRef as string | null | undefined) ?? null,
      },
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (e) {
    console.error('[bookings] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const existing = await prisma.booking.findUnique({
      where: { id },
      select: { propertyId: true, checkIn: true, checkOut: true },
    });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    const data = pickBookingFields(body);
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
    }
    const nextIn = (data.checkIn as string | undefined) ?? existing.checkIn;
    const nextOut = (data.checkOut as string | undefined) ?? existing.checkOut;
    if (nextIn >= nextOut) {
      return NextResponse.json({ error: '체크아웃은 체크인보다 뒤여야 합니다.' }, { status: 400 });
    }

    const booking = await prisma.booking.update({ where: { id }, data });
    return NextResponse.json(booking);
  } catch (e) {
    console.error('[bookings] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const existing = await prisma.booking.findUnique({ where: { id }, select: { propertyId: true } });
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canManageProperty(auth, existing.propertyId)) return forbidden();

    await prisma.booking.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[bookings] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
