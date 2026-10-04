import { withErrors, fail } from '@/lib/core/http';
import { getGuestStayGuide } from '@/lib/guest-stay-guide';
import { privateStayResponse, requireGuestStay } from '@/lib/guest-stay-store';
export const GET = withErrors('guest-stay/guide', async req => {
  const { stay } = await requireGuestStay(req);
  if (stay.phase !== 'staying') throw fail(403, '객실 이용 안내는 체크인 후 확인할 수 있습니다.', { code: 'stay_not_started' });
  const lang = new URL(req.url).searchParams.get('lang') || 'ko';
  return privateStayResponse(getGuestStayGuide(stay.property.slug, lang));
});
