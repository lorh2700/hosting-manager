import { z } from 'zod';
import { withErrors } from '@/lib/core/http';
import { fail } from '@/lib/core/errors';
import { cancelGuestInterimCleaningRequest, privateStayResponse, readStayJson, requireGuestStay, requireStayCsrf, throttleStayAttempt } from '@/lib/guest-stay-store';

const schema = z.object({ version: z.number().int().positive(), csrfToken: z.string().optional() }).strict();
export const PATCH = withErrors<{ id: string }>('guest-stay/requests/cancel', async (req, { params }) => {
  const auth = await requireGuestStay(req), body = await readStayJson(req);
  requireStayCsrf(req, auth.token, body);
  if (!z.string().uuid().safeParse(params.id).success) throw fail(404, '신청을 찾을 수 없습니다.');
  const input = schema.safeParse(body);
  if (!input.success) throw fail(400, '신청 내용을 확인해 주세요.');
  await throttleStayAttempt(req, `cancel:${auth.session.id}`, 30);
  return privateStayResponse(await cancelGuestInterimCleaningRequest(auth.stay, params.id, input.data.version));
});
