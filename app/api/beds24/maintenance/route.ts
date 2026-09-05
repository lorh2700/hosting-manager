import { prisma } from '@/lib/prisma';
import { describeBeds24Error, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { registerBeds24BookingVerified, cancelBeds24Booking, ROUTE_BUDGET_MS } from '@/lib/beds24-register';
import { buildMaintenanceNotes, MAINTENANCE_TITLE } from '@/lib/beds24-booking';
import { withAuth, ok, created, fail, MESSAGES, requireManage, readJson, str, dateStr, requireQuery } from '@/lib/core/http';

/**
 * 객실정비(유지보수) 차단 등록.
 *
 * Beds24 에 블랙아웃(status=black)을 만들어 모든 채널의 날짜를 막고, 확인된 뒤에만
 * 플랫폼에 type='block', source='maintenance' 이벤트로 저장한다. 차단은 청소를
 * 만들지 않으므로 청소매니저 신청·알림·빨래 업체 캘린더 피드에 올라가지 않는다.
 *
 * Body: { propertyId, startDate, endDate, reason?, beds24BookingId? }
 *   endDate 는 예약과 같은 규칙(차단이 풀리는 날, exclusive).
 */
export const POST = withAuth('beds24/maintenance', async (req, { auth, log }) => {
  if (!BEDS24_REFRESH_TOKEN) throw fail(500, 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.');
  const deadlineAt = Date.now() + ROUTE_BUDGET_MS;

  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const startDate = dateStr(body, 'startDate', { required: true })!;
  const endDate = dateStr(body, 'endDate', { required: true })!;
  if (startDate >= endDate) throw fail(400, '종료일은 시작일보다 뒤여야 합니다.');
  requireManage(auth, propertyId);

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, beds24RoomId: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (!property.beds24RoomId) throw fail(400, '해당 숙소에 Beds24 roomId가 설정되어 있지 않습니다.');

  const trimmedReason = (str(body, 'reason', { max: 200 }) ?? '').trim();

  const outcome = await registerBeds24BookingVerified({
    kind: 'block',
    roomId: Number(property.beds24RoomId),
    arrival: startDate,
    departure: endDate,
    firstName: MAINTENANCE_TITLE,
    lastName: '',
    numAdult: 1,
    numChild: 0,
    notes: buildMaintenanceNotes(trimmedReason),
    providedBookingId: body.beds24BookingId,
    deadlineAt,
    logPrefix: '[beds24/maintenance]',
  });
  if (!outcome.ok) throw fail(outcome.status, String(outcome.body.error), { ...outcome.body, error: undefined });

  const { bookingId, origin } = outcome;
  const eventData = {
    source: 'maintenance',
    title: MAINTENANCE_TITLE,
    startDate,
    endDate,
    type: 'block',
    description: [`사유: ${trimmedReason || '(미입력)'}`, '채널: 객실정비'].join('\n'),
    tags: ['maintenance'],
    guestEmail: null,
    guestPhone: null,
    numAdults: null,
    numChildren: null,
  };

  let event: { id: string };
  try {
    event = await prisma.event.upsert({
      where: { propertyId_channelId_originalUid: { propertyId, channelId: 'beds24', originalUid: String(bookingId) } },
      create: { propertyId, channelId: 'beds24', originalUid: String(bookingId), ...eventData },
      update: eventData,
      select: { id: true },
    });
  } catch (e) {
    console.error(`[beds24/maintenance] local save failed for Beds24 block #${bookingId}:`, e);
    throw fail(500, `Beds24 정비 차단(#${bookingId})은 확인되었지만 플랫폼 저장에 실패했습니다. 잠시 후 'Beds24 확인 후 등록'을 눌러주세요.`, {
      stage: 'local', pendingBeds24BookingId: String(bookingId),
    });
  }

  log(`registered maintenance event ${event.id} for Beds24 block #${bookingId} (${origin})`);
  return created({ success: true, eventId: event.id, beds24BookingId: String(bookingId), verified: true, origin });
});

/** 객실정비 해제. Query: ?eventId=<local event id> — Beds24 블랙아웃을 취소한 뒤 로컬 이벤트를 지운다. */
export const DELETE = withAuth('beds24/maintenance', async (req, { auth, log }) => {
  if (!BEDS24_REFRESH_TOKEN) throw fail(500, 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.');
  const eventId = requireQuery(req, 'eventId');

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, propertyId: true, channelId: true, type: true, originalUid: true, source: true },
  });
  if (!event) throw fail(404, MESSAGES.notFound);
  if (event.channelId !== 'beds24' || event.type !== 'block') throw fail(400, '이 이벤트는 Beds24 차단이 아닙니다.');
  requireManage(auth, event.propertyId);

  if (event.originalUid) {
    try {
      await cancelBeds24Booking(event.originalUid);
    } catch (e) {
      console.error('[beds24/maintenance] Beds24 cancel failed:', e);
      throw fail(502, `Beds24에서 차단 해제에 실패했습니다 (${describeBeds24Error(e)}). 잠시 후 다시 시도해주세요.`);
    }
  }

  await prisma.event.delete({ where: { id: eventId } });
  log(`released maintenance event ${eventId} (Beds24 #${event.originalUid ?? '-'})`);
  return ok({ success: true });
});
