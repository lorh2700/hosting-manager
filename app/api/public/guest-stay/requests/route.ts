import { withErrors } from '@/lib/core/http';
import { createGuestStayRequest, guestStayRequests, privateStayResponse, readStayJson, requireGuestStay, requireStayCsrf, throttleStayAttempt } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/requests', async req => {
  const auth = await requireGuestStay(req);
  return privateStayResponse({ requests: await guestStayRequests(auth.stay) });
});
export const POST = withErrors('guest-stay/requests', async req => {
  const auth = await requireGuestStay(req); const body = await readStayJson(req);
  requireStayCsrf(req, auth.token, body);
  await throttleStayAttempt(req, `request:${auth.session.id}`, 30);
  const { csrfToken: _csrfToken, ...input } = body;
  void _csrfToken;
  const result = await createGuestStayRequest(auth.stay, input, 'mobile');
  return privateStayResponse(result, result.replayed ? 200 : 201);
});
