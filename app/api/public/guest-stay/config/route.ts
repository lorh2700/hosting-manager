import { withErrors, fail } from '@/lib/core/http';
import { privateStayResponse, stayProperty } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/config', async req => {
  const slug = new URL(req.url).searchParams.get('slug') || '';
  if (!/^[a-z0-9_-]{1,60}$/.test(slug)) throw fail(400, '숙소를 확인해 주세요.');
  const property = await stayProperty(slug);
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  return privateStayResponse({ property, loginRequired: true });
});
