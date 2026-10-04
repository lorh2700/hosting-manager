import { getSessionWithUser, setSessionCookie, signToken } from '@/lib/auth';
import { acceptInvitation } from '@/lib/invitation-lifecycle';
import { withErrors, ok, fail } from '@/lib/core/http';
import { normalizeRole } from '@/lib/access';

export const POST = withErrors<{ token: string }>('invitations/accept', async (req, { params }) => {
  const auth = await getSessionWithUser(req, { allowInactive: true });
  if (!auth) throw fail(401, '초대받은 이메일의 계정으로 로그인해 주세요.');
  const user = await acceptInvitation(auth, params.token);
  await setSessionCookie(await signToken({ userId: user.id, email: user.email }));
  return ok({ success: true, user: { id: user.id, email: user.email }, profile: { role: normalizeRole(user.role), status: user.status, organizationId: user.organizationId, propertyIds: user.properties.map(item => item.propertyId), displayName: user.displayName || user.email } });
});
