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

    const where: Record<string, unknown> = {};
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (status) where.status = status;

    const apps = await prisma.cleaningApplication.findMany({ where, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(apps);
  } catch (e) {
    console.error('[cleaning-applications] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.cleaningId) {
      return NextResponse.json({ error: 'cleaningId는 필수입니다.' }, { status: 400 });
    }

    const app = await prisma.cleaningApplication.create({ data: body });
    return NextResponse.json(app, { status: 201 });
  } catch (e) {
    console.error('[cleaning-applications] POST error:', e);
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

    const app = await prisma.cleaningApplication.update({ where: { id }, data });
    return NextResponse.json(app);
  } catch (e) {
    console.error('[cleaning-applications] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
