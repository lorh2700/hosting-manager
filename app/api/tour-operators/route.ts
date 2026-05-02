import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, authorizeTourOperator } from '@/lib/auth';

const OPERATOR_WRITABLE_FIELDS = [
  'name', 'contactName', 'contactPhone', 'email', 'notifyChannel', 'notes',
] as const;

type OperatorWritable = Partial<Record<typeof OPERATOR_WRITABLE_FIELDS[number], unknown>>;

function pickWritable(body: Record<string, unknown>): OperatorWritable {
  const out: OperatorWritable = {};
  for (const key of OPERATOR_WRITABLE_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const operators = await prisma.tourOperator.findMany({
      where: auth.isAdmin ? undefined : { ownerId: auth.session.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tours: true } },
      },
    });

    return NextResponse.json(
      operators.map(op => ({
        id: op.id,
        name: op.name,
        contactName: op.contactName,
        contactPhone: op.contactPhone,
        email: op.email,
        notifyChannel: op.notifyChannel,
        publicToken: op.publicToken,
        notes: op.notes,
        ownerId: op.ownerId,
        tourCount: op._count.tours,
        createdAt: op.createdAt,
      })),
    );
  } catch (e) {
    console.error('[tour-operators] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name은 필수입니다.' }, { status: 400 });
    }

    const operator = await prisma.tourOperator.create({
      data: {
        ownerId: auth.session.userId,
        name: body.name,
        contactName: body.contactName ?? null,
        contactPhone: body.contactPhone ?? null,
        email: body.email ?? null,
        notifyChannel: body.notifyChannel ?? 'kakao',
        notes: body.notes ?? null,
        publicToken: generatePublicToken(),
      },
    });
    return NextResponse.json(operator, { status: 201 });
  } catch (e) {
    console.error('[tour-operators] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    const owned = await authorizeTourOperator(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const data: OperatorWritable & { publicToken?: string } = pickWritable(body);
    if (body.regenerateToken === true) {
      data.publicToken = generatePublicToken();
    }

    const operator = await prisma.tourOperator.update({
      where: { id },
      data: data as Parameters<typeof prisma.tourOperator.update>[0]['data'],
    });
    return NextResponse.json(operator);
  } catch (e) {
    console.error('[tour-operators] PUT error:', e);
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

    const owned = await authorizeTourOperator(id, auth.session.userId, { isAdmin: auth.isAdmin });
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await prisma.tourOperator.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[tour-operators] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
