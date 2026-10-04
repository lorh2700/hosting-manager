import { withErrors } from '@/lib/core/http';
import { guestStayCsrf, guestStayDTO, privateStayResponse, requireGuestStay } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/session', async req => {
  const auth = await requireGuestStay(req);
  return privateStayResponse({ stay: await guestStayDTO(auth.stay), csrfToken: guestStayCsrf(auth.token) });
});
