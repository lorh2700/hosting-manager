import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

/**
 * Set the list of property IDs a cleaner is scoped to.
 * Empty array = no scope (cleaner sees all open cleanings).
 * Backed by the UserProperty table on the cleaner's linked user.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!auth.isAdmin) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const propertyIds: string[] = Array.isArray(body?.propertyIds) ? body.propertyIds : [];

    const cleaner = await prisma.cleaner.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!cleaner) return NextResponse.json({ error: '청소 담당자를 찾을 수 없습니다.' }, { status: 404 });
    if (!cleaner.userId) {
      return NextResponse.json(
        { error: '로그인 계정이 없는 담당자는 지점을 지정할 수 없습니다. 먼저 계정을 만들어 주세요.' },
        { status: 400 }
      );
    }

    if (propertyIds.length > 0) {
      const existing = await prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true },
      });
      if (existing.length !== propertyIds.length) {
        return NextResponse.json({ error: '존재하지 않는 지점이 포함되어 있습니다.' }, { status: 400 });
      }
    }

    await prisma.$transaction([
      prisma.userProperty.deleteMany({ where: { userId: cleaner.userId } }),
      ...(propertyIds.length
        ? [prisma.userProperty.createMany({
            data: propertyIds.map(pid => ({ userId: cleaner.userId!, propertyId: pid })),
            skipDuplicates: true,
          })]
        : []),
    ]);

    return NextResponse.json({ propertyIds });
  } catch (e) {
    console.error('[cleaners/properties] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
