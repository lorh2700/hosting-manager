import { z } from 'zod';
import { withAuth, fail, requireManage } from '@/lib/core/http';
import { prisma } from '@/lib/prisma';
import { issueGuestStayAccess, liveStay, privateStayResponse, readStayJson, requireStayOrigin } from '@/lib/guest-stay-store';
const schema = z.object({ kind: z.enum(['event', 'booking']), id: z.string().uuid() }).strict();
export const POST = withAuth('guest-stays/access', async (req, { auth }) => {
  requireStayOrigin(req);
  const input = schema.safeParse(await readStayJson(req));
  if (!input.success) throw fail(400, '예약을 확인해 주세요.');
  const row = input.data.kind === 'event' ? await prisma.event.findUnique({ where: { id: input.data.id }, select: { propertyId: true } }) :
    await prisma.booking.findUnique({ where: { id: input.data.id }, select: { propertyId: true } });
  if (!row) throw fail(404, '예약을 찾을 수 없습니다.');
  requireManage(auth, row.propertyId);
  const stay = await liveStay({ kind: input.data.kind, id: input.data.id, propertyId: row.propertyId });
  if (!stay) throw fail(400, '확정 예약과 투숙 기간을 확인해 주세요.');
  return privateStayResponse(await issueGuestStayAccess(stay, auth.session.userId), 201);
});
