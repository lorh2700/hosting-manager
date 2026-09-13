import { withAuth, ok, fail } from '@/lib/core/http';
import { parseKoreanHolidays } from '@/lib/korean-holidays';
export const GET = withAuth('holidays', async () => {
  try {
    const response = await fetch('https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics', {next:{revalidate:21600},signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Holiday source unavailable');
    return ok({holidays:parseKoreanHolidays(await response.text()),source:'Google 대한민국의 휴일'});
  } catch { throw fail(503, '공휴일 정보를 불러오지 못했습니다.'); }
});
