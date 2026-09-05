import { prisma } from '@/lib/prisma';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, created, fail, readJson, str, dateStr, int } from '@/lib/core/http';

const FORMSPREE_FORM_ID = process.env.FORMSPREE_FORM_ID;

// 공개 예약 요청 (예약 페이지). 겹치는 일정이 있으면 거절하고, 호스트에게 Formspree 로 메일을 보낸다.
export const POST = withErrors('public/bookings', async (req) => {
  const rl = rateLimit(`public-booking:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw fail(429, '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');

  const body = await readJson(req);
  const propertyId = str(body, 'propertyId');
  const checkIn = dateStr(body, 'checkIn');
  const checkOut = dateStr(body, 'checkOut');
  const name = str(body, 'name', { max: 100 })?.trim();
  const email = str(body, 'email', { max: 200 })?.trim();
  const phone = str(body, 'phone', { max: 40 })?.trim();
  if (!propertyId || !checkIn || !checkOut || !name || !email || !phone) throw fail(400, '필수 정보를 모두 입력해주세요.');
  if (checkIn >= checkOut) throw fail(400, '체크아웃은 체크인보다 뒤여야 합니다.');
  const guests = int(body, 'guests', { min: 1, max: 50 }) ?? 1;
  const propertyName = str(body, 'propertyName', { max: 100 }) || '숙소';

  // Check for conflicts against every event and every non-cancelled direct booking.
  const [events, bookings] = await Promise.all([
    prisma.event.findMany({ where: { propertyId }, select: { startDate: true, endDate: true } }),
    prisma.booking.findMany({ where: { propertyId, status: { not: 'cancelled' } }, select: { checkIn: true, checkOut: true } }),
  ]);
  const ranges = [
    ...events.map(e => ({ start: e.startDate.slice(0, 10), end: e.endDate.slice(0, 10) })),
    ...bookings.map(b => ({ start: b.checkIn.slice(0, 10), end: b.checkOut.slice(0, 10) })),
  ];
  if (ranges.some(r => checkIn < r.end && checkOut > r.start)) throw fail(409, '선택한 날짜에 이미 예약이 있습니다.');

  const booking = await prisma.booking.create({
    data: { propertyId, name, email, phone, guests, checkIn, checkOut, status: 'pending' },
  });

  // Email notification (best-effort).
  if (FORMSPREE_FORM_ID) {
    try {
      await fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: `[예약요청] ${propertyName} — ${name}님 (${checkIn} ~ ${checkOut})`,
          숙소: propertyName, 체크인: checkIn, 체크아웃: checkOut, 인원: `${guests}명`, 이름: name, 연락처: phone, 이메일: email,
        }),
      });
    } catch (emailError) {
      console.error('Formspree notification failed:', emailError);
    }
  } else {
    console.warn('[public/bookings] FORMSPREE_FORM_ID not set; skipping email notification');
  }

  return created({ success: true, bookingId: booking.id });
});
