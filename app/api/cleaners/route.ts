import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { verifySession, getSessionWithUser } from '@/lib/auth';
import { lastFourDigits, normalizePhone, phoneToSyntheticEmail } from '@/lib/phone';

function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Create a cleaner-role User whose email is the phone-derived synthetic
 * email and whose password is the last 4 digits of the phone. Returns the
 * created user id, or null if phone was invalid or account already exists.
 */
async function createPhoneAccount(phone: string, displayName: string): Promise<string | null> {
  const synthetic = phoneToSyntheticEmail(phone);
  const last4 = lastFourDigits(phone);
  if (!synthetic || !last4) return null;

  const existing = await prisma.user.findUnique({ where: { email: synthetic } });
  if (existing) return existing.id;

  const hashed = await bcrypt.hash(last4, 12);
  const user = await prisma.user.create({
    data: {
      email: synthetic,
      password: hashed,
      displayName,
      phone: normalizePhone(phone),
      role: 'cleaner',
      status: 'active',
    },
  });
  return user.id;
}

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cleaners = await prisma.cleaner.findMany({
      where: auth.isAdmin ? undefined : { ownerId: auth.session.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            email: true,
            status: true,
            properties: { select: { propertyId: true } },
          },
        },
        invitations: {
          where: { status: 'pending' },
          select: { id: true, email: true, token: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const shaped = cleaners.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      publicToken: c.publicToken,
      userId: c.userId,
      ownerId: c.ownerId,
      createdAt: c.createdAt,
      linkedUser: c.user ? { email: c.user.email, status: c.user.status } : null,
      assignedPropertyIds: c.user?.properties.map(p => p.propertyId) ?? [],
      pendingInvitation: c.invitations[0] ?? null,
    }));

    return NextResponse.json(shaped);
  } catch (e) {
    console.error('[cleaners] GET error:', e);
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

    const normalizedPhone = body.phone ? normalizePhone(body.phone) : null;
    if (body.phone && !normalizedPhone) {
      return NextResponse.json({ error: '전화번호 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    // Auto-create phone-based cleaner account (email = synthetic, password = last4)
    const userId = normalizedPhone ? await createPhoneAccount(normalizedPhone, body.name) : null;

    const cleaner = await prisma.cleaner.create({
      data: {
        name: body.name,
        phone: normalizedPhone,
        ownerId: session.userId,
        publicToken: generatePublicToken(),
        userId,
      },
    });
    return NextResponse.json(cleaner, { status: 201 });
  } catch (e) {
    console.error('[cleaners] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, regenerateToken, ...data } = body;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    if (regenerateToken) {
      data.publicToken = generatePublicToken();
    }

    // Normalize phone; if it changed on a linked user, keep the synthetic
    // email + password (last4) aligned so the cleaner can keep logging in
    // with their current number.
    if (data.phone !== undefined) {
      const normalized = data.phone ? normalizePhone(data.phone) : null;
      if (data.phone && !normalized) {
        return NextResponse.json({ error: '전화번호 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      data.phone = normalized;
    }

    const before = await prisma.cleaner.findUnique({
      where: { id },
      select: { phone: true, userId: true, name: true },
    });
    if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // If the cleaner has no linked user yet but now gains a phone, create one.
    if (!before.userId && data.phone) {
      data.userId = await createPhoneAccount(data.phone, data.name ?? before.name);
    }

    const cleaner = await prisma.cleaner.update({ where: { id }, data });

    // Sync linked User when phone changed on an already-linked cleaner.
    if (before.userId && data.phone !== undefined && data.phone !== before.phone) {
      const linked = await prisma.user.findUnique({ where: { id: before.userId } });
      if (linked) {
        const synthetic = data.phone ? phoneToSyntheticEmail(data.phone) : null;
        const last4 = data.phone ? lastFourDigits(data.phone) : null;
        if (synthetic && last4) {
          await prisma.user.update({
            where: { id: before.userId },
            data: {
              email: synthetic,
              phone: data.phone,
              password: await bcrypt.hash(last4, 12),
            },
          });
        }
      }
    }

    return NextResponse.json(cleaner);
  } catch (e) {
    console.error('[cleaners] PUT error:', e);
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

    await prisma.cleaner.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[cleaners] DELETE error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
