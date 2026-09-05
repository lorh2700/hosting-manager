import { clearSessionCookie } from '@/lib/auth';
import { withErrors, ok } from '@/lib/core/http';

export const POST = withErrors('auth/logout', async () => {
  await clearSessionCookie();
  return ok({ ok: true });
});
