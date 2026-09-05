import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { type SessionAuth } from '@/lib/auth';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, requireQuery } from '@/lib/core/http';
import { lastFourDigits, normalizePhone, phoneToSyntheticEmail } from '@/lib/phone';

function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

// 청소매니저 레코드는 만든 호스트(ownerId)와 관리자만 수정·삭제할 수 있다.
// 전화번호 변경은 연결된 로그인 계정의 이메일·비밀번호까지 바꾸므로 특히 중요.
function requireCleanerOwner(auth: SessionAuth, cleaner: { ownerId: string }): void {
  if (!(auth.isAdmin || cleaner.ownerId === auth.session.userId)) throw fail(403, MESSAGES.forbidden);
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

  const user = await prisma.user.create({
    data: {
      email: synthetic,
      password: await bcrypt.hash(last4, 12),
      displayName,
      phone: normalizePhone(phone),
      role: 'cleaner',
      status: 'active',
    },
  });
  return user.id;
}

export const GET = withAuth('cleaners', async (_req, { auth }) => {
  const cleaners = await prisma.cleaner.findMany({
    where: auth.isAdmin ? undefined : { ownerId: auth.session.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { email: true, status: true, properties: { select: { propertyId: true } } } },
      invitations: {
        where: { status: 'pending' },
        select: { id: true, email: true, token: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  return ok(cleaners.map(c => ({
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
  })));
});

export const POST = withAuth('cleaners', async (req, { auth }) => {
  // 청소매니저 계정이 다른 청소매니저를 만드는 것은 허용하지 않는다.
  if (auth.user.role === 'cleaner') throw fail(403, MESSAGES.forbidden);
  const body = await readJson(req);
  const name = str(body, 'name', { required: true, max: 100 })!.trim();

  const normalizedPhone = body.phone ? normalizePhone(String(body.phone)) : null;
  if (body.phone && !normalizedPhone) throw fail(400, '전화번호 형식이 올바르지 않습니다.');

  // Auto-create phone-based cleaner account (email = synthetic, password = last4)
  const userId = normalizedPhone ? await createPhoneAccount(normalizedPhone, name) : null;

  const cleaner = await prisma.cleaner.create({
    data: { name, phone: normalizedPhone, ownerId: auth.session.userId, publicToken: generatePublicToken(), userId },
  });
  return created(cleaner);
});

export const PUT = withAuth('cleaners', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;

  const before = await prisma.cleaner.findUnique({ where: { id }, select: { phone: true, userId: true, name: true, ownerId: true } });
  if (!before) throw fail(404, MESSAGES.notFound);
  requireCleanerOwner(auth, before);

  // 허용 필드만: name, phone, regenerateToken. (ownerId/userId 등은 바꿀 수 없다)
  const data: { name?: string; phone?: string | null; publicToken?: string; userId?: string | null } = {};
  const name = str(body, 'name', { max: 100 });
  if (name && name.trim()) data.name = name.trim();
  if (body.regenerateToken) data.publicToken = generatePublicToken();

  if (body.phone !== undefined) {
    const normalized = body.phone ? normalizePhone(String(body.phone)) : null;
    if (body.phone && !normalized) throw fail(400, '전화번호 형식이 올바르지 않습니다.');
    data.phone = normalized;
  }
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  // If the cleaner has no linked user yet but now gains a phone, create one.
  if (!before.userId && data.phone) data.userId = await createPhoneAccount(data.phone, data.name ?? before.name);

  const cleaner = await prisma.cleaner.update({ where: { id }, data });

  // Sync linked User when phone changed on an already-linked cleaner so they keep logging in.
  if (before.userId && data.phone !== undefined && data.phone !== before.phone) {
    const synthetic = data.phone ? phoneToSyntheticEmail(data.phone) : null;
    const last4 = data.phone ? lastFourDigits(data.phone) : null;
    if (synthetic && last4) {
      await prisma.user.update({
        where: { id: before.userId },
        data: { email: synthetic, phone: data.phone, password: await bcrypt.hash(last4, 12) },
      });
    }
  }

  return ok(cleaner);
});

export const DELETE = withAuth('cleaners', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const cleaner = await prisma.cleaner.findUnique({ where: { id }, select: { ownerId: true } });
  if (!cleaner) throw fail(404, MESSAGES.notFound);
  requireCleanerOwner(auth, cleaner);

  await prisma.cleaner.delete({ where: { id } });
  return ok({ success: true });
});
