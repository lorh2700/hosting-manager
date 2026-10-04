import { withErrors } from '@/lib/core/http';
import { clearGuestStayCookie, privateStayResponse, readStayJson, requireGuestStay, requireStayCsrf } from '@/lib/guest-stay-store';
import { prisma } from '@/lib/prisma';
export const POST = withErrors('guest-stay/logout', async req => {
  const auth = await requireGuestStay(req); const body = await readStayJson(req);
  requireStayCsrf(req, auth.token, body);
  await prisma.guestStaySession.update({ where: { id: auth.session.id }, data: { revokedAt: new Date() } });
  const response = privateStayResponse({ ok: true }); clearGuestStayCookie(response); return response;
});
