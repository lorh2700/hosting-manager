import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession } from '@/lib/auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const property = await prisma.property.findUnique({
      where: { id },
      include: { channels: true },
    });
    if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(property);
  } catch (e) {
    console.error('[properties/id] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();

    const allowedFields = ['name', 'timezone', 'beds24PropId', 'doorPassword', 'addressUrl', 'roomReadyMessage', 'basePrice', 'maxGuests', 'description'];
    const data: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) data[key] = body[key];
    }

    const updated = await prisma.property.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    console.error('[properties/id] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    await prisma.property.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[properties/id] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
