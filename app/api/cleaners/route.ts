import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { type SessionAuth } from '@/lib/auth';
import { canManageCleaner } from '@/lib/access';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, requireQuery } from '@/lib/core/http';
import { lastFourDigits, normalizePhone, phoneToSyntheticEmail } from '@/lib/phone';

function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

// 청소담당자 프로필은 만든 호스트(ownerId)와 관리자만 수정·삭제할 수 있다.
// 전화번호 변경은 연결된 로그인 계정의 이메일·비밀번호까지 바꾸므로 특히 중요.
function requireCleanerOwner(auth: SessionAuth, cleaner: { ownerId: string }): void {
  if (!canManageCleaner(auth, cleaner)) throw fail(403, MESSAGES.forbidden);
}

type CleanerRow = {
  id: string; name: string; phone: string | null; publicToken: string | null; userId: string | null;
  ownerId: string; notifyNewOpen: boolean; createdAt: Date;
  user: { email: string; status: string } | null;
  assignments: { propertyId: string }[];
  invitations: { id: string; email: string; token: string; expiresAt: Date }[];
};

/**
 * 화면용 응답. 담당자의 정체성은 이 프로필이고, 로그인은 선택 사항이다.
 *  - login: null = 계정 없음 / { status } = 전화번호 로그인 계정 (active|suspended)
 *  - assignedPropertyIds: 비어 있으면 소유 호스트의 모든 숙소를 본다
 */
function serialize(c: CleanerRow) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    publicToken: c.publicToken,
    userId: c.userId,
    ownerId: c.ownerId,
    notifyNewOpen: c.notifyNewOpen,
    createdAt: c.createdAt,
    login: c.user ? { email: c.user.email, status: c.user.status } : null,
    // 이전 화면 호환
    linkedUser: c.user ? { email: c.user.email, status: c.user.status } : null,
    assignedPropertyIds: c.assignments.map(a => a.propertyId),
    pendingInvitation: c.invitations[0] ?? null,
  };
}

const INCLUDE = {
  user: { select: { email: true, status: true } },
  assignments: { select: { propertyId: true } },
  invitations: {
    where: { status: 'pending' },
    select: { id: true, email: true, token: true, expiresAt: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
};

export const GET = withAuth('cleaners', async (_req, { auth }) => {
  const cleaners = await prisma.cleaner.findMany({
    where: auth.role === 'admin' ? undefined : { ownerId: auth.session.userId },
    orderBy: { createdAt: 'desc' },
    include: INCLUDE,
  });
  return ok(cleaners.map(c => serialize(c as CleanerRow)));
});

/**
 * 담당자 프로필 생성. 로그인 계정은 자동으로 만들지 않는다 —
 * 화면의 "앱 로그인 만들기"(/api/cleaners/[id]/reset-password)로 명시적으로 만든다.
 */
export const POST = withAuth('cleaners', async (req, { auth }) => {
  if (auth.role === 'cleaner') throw fail(403, MESSAGES.forbidden);
  const body = await readJson(req);
  const name = str(body, 'name', { required: true, max: 100 })!.trim();

  const normalizedPhone = body.phone ? normalizePhone(String(body.phone)) : null;
  if (body.phone && !normalizedPhone) throw fail(400, '전화번호 형식이 올바르지 않습니다.');
  if (normalizedPhone && await prisma.cleaner.findUnique({ where: { phone: normalizedPhone }, select: { id: true } })) {
    throw fail(409, '같은 전화번호의 담당자가 이미 있습니다.');
  }

  const cleaner = await prisma.cleaner.create({
    data: { name, phone: normalizedPhone, ownerId: auth.session.userId, publicToken: generatePublicToken() },
    include: INCLUDE,
  });
  return created(serialize(cleaner as CleanerRow));
});

/**
 * 허용 필드: name, phone, regenerateToken, notifyNewOpen, loginEnabled.
 * (ownerId/userId 는 바꿀 수 없다. 배정 지점은 /api/cleaners/[id]/properties.)
 */
export const PUT = withAuth('cleaners', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;

  const before = await prisma.cleaner.findUnique({ where: { id }, select: { phone: true, userId: true, name: true, ownerId: true } });
  if (!before) throw fail(404, MESSAGES.notFound);
  requireCleanerOwner(auth, before);

  const data: { name?: string; phone?: string | null; publicToken?: string; notifyNewOpen?: boolean } = {};
  const name = str(body, 'name', { max: 100 });
  if (name && name.trim()) data.name = name.trim();
  if (body.regenerateToken) data.publicToken = generatePublicToken();
  if (typeof body.notifyNewOpen === 'boolean') data.notifyNewOpen = body.notifyNewOpen;

  if (body.phone !== undefined) {
    const normalized = body.phone ? normalizePhone(String(body.phone)) : null;
    if (body.phone && !normalized) throw fail(400, '전화번호 형식이 올바르지 않습니다.');
    if (normalized && normalized !== before.phone) {
      const dup = await prisma.cleaner.findUnique({ where: { phone: normalized }, select: { id: true } });
      if (dup && dup.id !== id) throw fail(409, '같은 전화번호의 담당자가 이미 있습니다.');
    }
    data.phone = normalized;
  }

  // 앱 로그인 켜기/끄기 — 연결된 계정의 status 만 바꾼다 (계정 생성은 reset-password).
  let loginStatus: 'active' | 'suspended' | undefined;
  if (typeof body.loginEnabled === 'boolean') {
    if (!before.userId) throw fail(400, '먼저 앱 로그인 계정을 만들어 주세요.');
    loginStatus = body.loginEnabled ? 'active' : 'suspended';
  }

  if (Object.keys(data).length === 0 && !loginStatus) throw fail(400, MESSAGES.noFields);

  const cleaner = await prisma.cleaner.update({ where: { id }, data, include: INCLUDE });

  if (before.userId) {
    const userData: { email?: string; phone?: string | null; password?: string; status?: string } = {};
    // 전화번호가 바뀌면 로그인 식별자(합성 이메일)와 뒷 4자리 비밀번호도 따라간다.
    if (data.phone !== undefined && data.phone !== before.phone) {
      const synthetic = data.phone ? phoneToSyntheticEmail(data.phone) : null;
      const last4 = data.phone ? lastFourDigits(data.phone) : null;
      if (synthetic && last4) {
        userData.email = synthetic;
        userData.phone = data.phone;
        userData.password = await bcrypt.hash(last4, 12);
      }
    }
    if (loginStatus) userData.status = loginStatus;
    if (Object.keys(userData).length > 0) {
      await prisma.user.update({ where: { id: before.userId }, data: userData });
      if (cleaner.user && loginStatus) cleaner.user.status = loginStatus;
    }
  }

  return ok(serialize(cleaner as CleanerRow));
});

/** 프로필 삭제. 연결된 로그인 계정(청소담당자 전용)도 함께 지워 고아 계정을 남기지 않는다. */
export const DELETE = withAuth('cleaners', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const cleaner = await prisma.cleaner.findUnique({ where: { id }, select: { ownerId: true, userId: true } });
  if (!cleaner) throw fail(404, MESSAGES.notFound);
  requireCleanerOwner(auth, cleaner);

  await prisma.cleaner.delete({ where: { id } });
  if (cleaner.userId) await prisma.user.delete({ where: { id: cleaner.userId } }).catch(() => null);
  return ok({ success: true });
});
