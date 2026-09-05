import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail } from '@/lib/core/http';

// 최초 부트스트랩: 아직 관리자가 없을 때 현재 계정을 super_admin 으로 승격한다.
export const POST = withAuth('setup', async (_req, { auth }) => {
  if (await prisma.user.findFirst({ where: { role: 'super_admin' } })) throw fail(409, '이미 super_admin 계정이 존재합니다.');
  if (await prisma.user.findFirst({ where: { role: 'admin' } })) throw fail(409, '기존 admin 계정이 존재합니다.');

  const user = await prisma.user.update({ where: { id: auth.session.userId }, data: { role: 'super_admin' } });
  return ok({ message: `완료! ${user.email} 계정이 super_admin으로 설정되었습니다.`, email: user.email });
});
