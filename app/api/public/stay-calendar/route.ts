import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail } from '@/lib/core/http';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { fetchStayCalendar, isoDay } from '@/lib/beds24-stay-calendar';
import { todayKst } from '@/lib/dates';
import { propertyAllowsModule } from '@/lib/operational-access';

export const GET = withErrors('public/stay-calendar', async req => {
  if (!rateLimit(`stay-calendar:${clientIp(req)}`, 40, 60_000).ok) throw fail(429, '잠시 후 다시 확인해주세요.');
  const params = new URL(req.url).searchParams;
  const start = isoDay.safeParse(params.get('start'));
  const end = isoDay.safeParse(params.get('end'));
  const propertyId = params.get('propertyId');
  if (!start.success || !end.success || !propertyId || propertyId.length > 128) throw fail(400, '숙소와 날짜를 확인해주세요.');
  const span = (Date.parse(end.data) - Date.parse(start.data)) / 86400000;
  if (span < 0 || span > 62) throw fail(400, '조회 기간은 최대 63일입니다.');
  const property = await prisma.property.findUnique({ where: { id: propertyId }, include: { organization: { select: { status: true, features: true } } } });
  const roomId = Number(property?.beds24RoomId);
  const bedsPropertyId = Number(property?.beds24PropId);
  if (property?.status !== 'active' || !Number.isSafeInteger(roomId) || roomId < 1 || !Number.isSafeInteger(bedsPropertyId) || bedsPropertyId < 1) throw fail(503, '이 숙소의 예약 일정을 확인 중입니다.');
  if (!propertyAllowsModule(property, 'reservations') || !propertyAllowsModule(property, 'integrations')) {
    throw fail(403, '현재 이 숙소에서 해당 서비스를 사용할 수 없습니다.', { code: 'service_disabled' });
  }
  // Beds24 omits past dates rather than returning closed rows for them.
  const firstDate = start.data < todayKst() ? todayKst() : start.data;
  if (end.data < firstDate) throw fail(400, '미래 일정을 선택해주세요.');
  const calendar = await fetchStayCalendar(roomId, bedsPropertyId, firstDate, end.data);
  const response = ok({ ...calendar, checkedAt: new Date().toISOString() });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
