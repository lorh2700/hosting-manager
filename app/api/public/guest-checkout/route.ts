import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, readJson } from '@/lib/core/http';
import { verifyCheckoutQr } from '@/lib/checkout-qr';
import { todayKst } from '@/lib/dates';
import { getCheckoutStatus, recordCheckoutSignal, notifyCheckoutRecipients } from '@/lib/checkout';
import { rateLimit, clientIp } from '@/lib/rateLimit';

// Both actions use POST so QR credentials never appear in query/access logs.
// 'status' is read-only; a scan or link preview cannot confirm checkout.
export const POST = withErrors('public/guest-checkout', async req => {
  if (!rateLimit(`guest-checkout:${clientIp(req)}`, 30, 60_000).ok) throw fail(429, '잠시 후 다시 시도해주세요. / Please try again shortly.');
  const body = await readJson(req);
  if (!['status', 'confirm'].includes(String(body.action))) throw fail(400, '잘못된 요청입니다.');
  const propertyId = verifyCheckoutQr(body.token);
  if (!propertyId) throw fail(403, '유효하지 않은 QR입니다. 호스트에게 문의해주세요. / Please contact your host.');
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true, status: true } });
  if (!property || property.status !== 'active') throw fail(404, '이 숙소의 체크아웃을 확인할 수 없습니다. / Checkout is unavailable.');
  const date = todayKst();
  // Re-read the reservation for every confirmation; never accept a client date/event ID.
  const departures = await prisma.event.findMany({ where: { propertyId, type: 'reservation', endDate: date }, select: { id: true } });
  const status = await getCheckoutStatus(propertyId, date);
  const eligible = departures.length === 1;
  if (body.action === 'status') {
    const response = ok({ propertyName: property.name, date, confirmed: status.confirmed, eligible,
      message: eligible || status.confirmed ? null : '오늘 퇴실 예약을 확인할 수 없습니다. 호스트에게 문의해주세요. / Please contact your host to confirm today’s checkout.' });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (body.confirmedDeparture !== true) throw fail(400, '퇴실 여부를 확인해주세요. / Please confirm you have left.');
  if (body.viewedDate !== date) throw fail(409, '날짜가 변경되었습니다. 다시 확인해주세요. / Please refresh to confirm today’s checkout.');
  if (status.confirmed) return ok({ confirmed: true, duplicate: true });
  if (!eligible) throw fail(409, '오늘 퇴실 예약을 확인할 수 없습니다. 호스트에게 문의해주세요. / Please contact your host.');
  const rec = await recordCheckoutSignal({ propertyId, date, eventId: departures[0].id, kind: 'guest_pad', note: 'guest_qr' });
  if (!rec.duplicate && rec.newlyConfirmed) {
    // A notification failure must not turn a saved checkout into a guest-facing failure.
    await notifyCheckoutRecipients({ propertyId, date, kind: 'guest_pad', at: rec.signal.at })
      .catch(() => console.error('[guest-checkout] notification failed', propertyId, date));
  }
  return ok({ confirmed: true, duplicate: rec.duplicate });
});
