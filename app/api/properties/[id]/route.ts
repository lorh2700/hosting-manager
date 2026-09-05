import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getSessionWithUser,
  canManageProperty,
  getVisiblePropertyIds,
  isPropertyOwnerOrAdmin,
} from '@/lib/auth';

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    // 읽기는 청소매니저도 자기 호스트의 숙소라면 허용 (도어코드·주소 안내용).
    const visible = await getVisiblePropertyIds(auth, [id]);
    if (visible !== null && visible.length === 0) return forbidden();

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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    if (!canManageProperty(auth, id)) return forbidden();

    const body = await req.json();

    const allowedFields = ['name', 'timezone', 'beds24PropId', 'beds24RoomId', 'doorPassword', 'addressUrl', 'roomReadyMessage', 'basePrice', 'maxGuests', 'description'];
    const data: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) data[key] = body[key];
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 });
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
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    // 숙소 삭제는 예약·청소·메시지까지 연쇄 삭제되므로 소유자 또는 관리자만.
    if (!(await isPropertyOwnerOrAdmin(auth, id))) return forbidden();

    await prisma.property.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[properties/id] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
