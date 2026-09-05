import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, created, fail, readJson, str } from '@/lib/core/http';
import type { UserRole } from '@/lib/types';

// 관리자·매니저는 여기서 초대한다. 청소담당자 초대는 프로필에서(/api/cleaners/[id]/invite) —
// 프로필 없는 청소담당자 계정을 만들지 않기 위해 cleanerId 없는 cleaner 초대는 거절한다.
const INVITABLE_ROLES: UserRole[] = ['admin', 'manager', 'cleaner'];

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

export const GET = withAuth('invitations', async () => {
  return ok(await prisma.invitation.findMany({ orderBy: { createdAt: 'desc' } }));
}, { admin: true });

export const POST = withAuth('invitations', async (req, { auth }) => {
  const body = await readJson(req);
  const email = str(body, 'email', { required: true, max: 200 })!.trim().toLowerCase();
  const role = str(body, 'role', { required: true })! as UserRole;
  if (!INVITABLE_ROLES.includes(role)) throw fail(400, '유효하지 않은 역할입니다.');
  const cleanerId = str(body, 'cleanerId') || null;
  // 숙소 범위는 매니저에게만 의미가 있다 (관리자는 전체, 청소담당자는 프로필 배정).
  const propertyIds = role === 'manager' && Array.isArray(body.propertyIds)
    ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  if (role === 'cleaner' && !cleanerId) throw fail(400, '청소담당자는 청소 담당자 관리에서 프로필을 만든 뒤 초대하세요.');
  if (cleanerId) {
    if (role !== 'cleaner') throw fail(400, 'cleanerId는 cleaner 역할에만 사용할 수 있습니다.');
    const cleaner = await prisma.cleaner.findUnique({ where: { id: cleanerId }, select: { id: true, userId: true } });
    if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
    if (cleaner.userId) throw fail(409, '이미 로그인 계정과 연결된 담당자입니다.');
  }

  if (await prisma.user.findUnique({ where: { email } })) throw fail(409, '이미 가입된 이메일입니다.');
  if (await prisma.invitation.findFirst({ where: { email, status: 'pending' } })) throw fail(409, '이미 대기중인 초대가 있습니다.');

  const invitation = await prisma.invitation.create({
    data: {
      email,
      role,
      propertyIds,
      invitedBy: auth.session.userId,
      cleanerId,
      status: 'pending',
      token: generateToken(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return created({ ...invitation, inviteLink: `/invite/${invitation.token}` });
}, { admin: true });
