import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const propertyWhere = auth.isAdmin ? {} : { id: { in: auth.propertyIds! } };
    const properties = await prisma.property.findMany({
      where: propertyWhere,
      select: { id: true },
    });
    const propertyIds = properties.map(p => p.id);
    if (propertyIds.length === 0) {
      return NextResponse.json({ supplyTodos: [] });
    }

    const supplyTodos = await prisma.supplyTodo.findMany({
      where: { propertyId: { in: propertyIds } },
      select: {
        id: true, propertyId: true, date: true, text: true,
        done: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      { supplyTodos },
      {
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=120',
        },
      },
    );
  } catch (e) {
    console.error('[admin/calendar/supply-todos] GET error:', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.', message }, { status: 500 });
  }
}
