import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { withAuth, created, fail, readJson, str } from '@/lib/core/http';

type Params = { id: string };

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/** 청소 담당자에게 포털 계정 초대 링크 발급 (관리자). */
export const POST = withAuth<Params>('cleaners/invite', async (req, { auth, params }) => {
  const body = await readJson(req);
  const email = str(body, 'email', { required: true, max: 200 })!.trim();
  const propertyIds = Array.isArray(body.propertyIds)
    ? (body.propertyIds as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const cleaner = await prisma.cleaner.findUnique({ where: { id: params.id }, select: { id: true, userId: true, ownerId: true } });
  if (!cleaner) throw fail(404, '청소 담당자를 찾을 수 없습니다.');
  if (cleaner.userId) throw fail(409, '이미 포털 계정과 연결된 담당자입니다.');

  if (await prisma.user.findUnique({ where: { email } })) throw fail(409, '이미 가입된 이메일입니다.');
  if (await prisma.invitation.findFirst({ where: { email, status: 'pending' } })) throw fail(409, '이미 대기중인 초대가 있습니다.');

  const invitation = await prisma.invitation.create({
    data: {
      email,
      role: 'cleaner',
      propertyIds,
      invitedBy: auth.session.userId,
      cleanerId: cleaner.id,
      status: 'pending',
      token: generateToken(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return created({ ...invitation, inviteLink: `/invite/${invitation.token}` });
}, { admin: true });
