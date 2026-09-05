import { getSession } from '@/lib/auth';
import { withErrors, ok, errorResponse } from '@/lib/core/http';

// 현재 세션의 사용자·프로필. 승인 대기 계정도 자기 상태를 볼 수 있어야 하므로
// (승인 대기 화면) 상태 검사가 없는 getSession() 을 쓴다.
export const GET = withErrors('auth/me', async () => {
  const session = await getSession();
  if (!session) return errorResponse(401, 'Unauthorized', { user: null, profile: null });
  return ok(session);
});
