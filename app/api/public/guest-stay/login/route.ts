import { withErrors, fail } from '@/lib/core/http';
import { guestStayLoginSchema } from '@/lib/guest-stay';
import { guestStayCsrf, guestStayDTO, loginGuestStay, privateStayResponse, readStayJson, requireStayOrigin, setGuestStayCookie } from '@/lib/guest-stay-store';
export const POST = withErrors('guest-stay/login', async req => {
  requireStayOrigin(req);
  const input = guestStayLoginSchema.safeParse(await readStayJson(req));
  if (!input.success) throw fail(400, '예약자 이름과 이용 정보를 확인해 주세요.', { code: 'invalid_credentials' });
  const result = await loginGuestStay(req, input.data);
  const response = privateStayResponse({ stay: await guestStayDTO(result.stay), csrfToken: guestStayCsrf(result.token) });
  setGuestStayCookie(response, result.token, result.expiresAt);
  return response;
});
