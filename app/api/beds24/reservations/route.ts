import { prisma } from '@/lib/prisma';
import { ensureCleaningsForProperty } from '@/lib/sync-engine';
import { describeBeds24Error, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { registerBeds24BookingVerified, cancelBeds24Booking, ROUTE_BUDGET_MS } from '@/lib/beds24-register';
import { withAuth, ok, created, fail, MESSAGES, requireManage, readJson, str, int, requireQuery } from '@/lib/core/http';

/**
 * 직접 예약 등록. 플랫폼 저장은 Beds24 등록이 "확인된 뒤에만" 한다 (lib/beds24-register 참조).
 *
 * Body: {
 *   propertyId, startDate (arrival), endDate (departure),
 *   name, email?, phone?, numAdult?, numChild?, notes?, tags?,
 *   beds24BookingId?  — 이전 시도에서 Beds24 등록까지는 됐지만 확인/저장에 실패한 경우.
 * }
 * 실패 응답에 pendingBeds24BookingId 가 있으면 Beds24 에는 예약이 있고 플랫폼에는 아직 없다는 뜻.
 * clearPending 이 true 면 클라이언트는 보관 중인 pending id 를 버려야 한다.
 */
export const POST = withAuth('beds24/reservations', async (req, { auth, log }) => {
  if (!BEDS24_REFRESH_TOKEN) throw fail(500, 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.');
  const deadlineAt = Date.now() + ROUTE_BUDGET_MS;

  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const startDate = str(body, 'startDate', { required: true })!;
  const endDate = str(body, 'endDate', { required: true })!;
  const name = str(body, 'name', { required: true })!;
  if (startDate >= endDate) throw fail(400, '체크아웃은 체크인보다 뒤여야 합니다.');
  requireManage(auth, propertyId);

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, beds24PropId: true, beds24RoomId: true } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (!property.beds24RoomId) throw fail(400, '해당 숙소에 Beds24 roomId가 설정되어 있지 않습니다.');

  const trimmedName = name.slice(0, 80).trim();
  const [firstName, ...rest] = trimmedName.split(/\s+/);
  const lastName = rest.join(' ');
  const trimmedNotes = str(body, 'notes', { max: 1000 }) ?? '';
  const trimmedEmail = (str(body, 'email', { max: 200 }) ?? '').trim();
  const trimmedPhone = (str(body, 'phone', { max: 40 }) ?? '').trim();
  const adults = int(body, 'numAdult', { min: 1, max: 20 }) ?? 1;
  const children = int(body, 'numChild', { min: 0, max: 20 }) ?? 0;
  const sanitizedTags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).map(t => typeof t === 'string' ? t.trim() : '').filter(t => t.length > 0 && t.length <= 40).slice(0, 20)
    : [];

  const arrival = startDate.slice(0, 10);
  const departure = endDate.slice(0, 10);

  const outcome = await registerBeds24BookingVerified({
    kind: 'reservation',
    roomId: Number(property.beds24RoomId),
    arrival,
    departure,
    firstName: firstName || trimmedName,
    lastName: lastName || '',
    email: trimmedEmail,
    phone: trimmedPhone,
    numAdult: adults,
    numChild: children,
    notes: trimmedNotes,
    providedBookingId: body.beds24BookingId,
    deadlineAt,
    logPrefix: '[beds24/reservations]',
  });
  if (!outcome.ok) throw fail(outcome.status, String(outcome.body.error), { ...outcome.body, error: undefined });

  const { bookingId, origin } = outcome;

  const descriptionParts = [
    `게스트: ${trimmedName}`,
    trimmedEmail ? `이메일: ${trimmedEmail}` : '',
    trimmedPhone ? `연락처: ${trimmedPhone}` : '',
    `인원: 성인 ${adults}명${children > 0 ? `, 아동 ${children}명` : ''}`,
    `채널: 직접 등록`,
    trimmedNotes ? `메모: ${trimmedNotes}` : '',
  ].filter(Boolean).join('\n');

  const eventData = {
    source: 'manual-reservation',
    title: trimmedName,
    startDate: arrival,
    endDate: departure,
    type: 'reservation',
    description: descriptionParts,
    tags: sanitizedTags,
    guestEmail: trimmedEmail || null,
    guestPhone: trimmedPhone || null,
    numAdults: adults,
    numChildren: children,
  };

  let event: { id: string };
  try {
    // 동기화 크론이 먼저 같은 Beds24 예약을 가져왔을 수도 있으므로 upsert.
    event = await prisma.event.upsert({
      where: { propertyId_channelId_originalUid: { propertyId, channelId: 'beds24', originalUid: String(bookingId) } },
      create: { propertyId, channelId: 'beds24', originalUid: String(bookingId), ...eventData },
      update: eventData,
      select: { id: true },
    });
  } catch (e) {
    console.error(`[beds24/reservations] local save failed for Beds24 booking #${bookingId}:`, e);
    throw fail(500, `Beds24 예약(#${bookingId}) 등록은 확인되었지만 플랫폼 저장에 실패했습니다. 잠시 후 'Beds24 확인 후 등록'을 눌러주세요.`, {
      stage: 'local', pendingBeds24BookingId: String(bookingId),
    });
  }

  log(`registered event ${event.id} for Beds24 booking #${bookingId} (${origin})`);
  return created({ success: true, eventId: event.id, beds24BookingId: String(bookingId), verified: true, origin, beds24Status: outcome.booking.status ?? null });
});

/**
 * Cancel a Beds24 booking (reservation or block) for an event we have locally.
 * Query: ?eventId=<local event id>
 */
export const DELETE = withAuth('beds24/reservations', async (req, { auth }) => {
  if (!BEDS24_REFRESH_TOKEN) throw fail(500, 'BEDS24_REFRESH_TOKEN이 설정되지 않았습니다.');
  const eventId = requireQuery(req, 'eventId');

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, propertyId: true, channelId: true, type: true, originalUid: true, source: true },
  });
  if (!event) throw fail(404, MESSAGES.notFound);
  if (event.channelId !== 'beds24') throw fail(400, '이 이벤트는 Beds24 예약이 아닙니다.');
  requireManage(auth, event.propertyId);

  if (event.originalUid) {
    try {
      await cancelBeds24Booking(event.originalUid);
    } catch (e) {
      console.error('[beds24/reservations] Beds24 cancel failed:', e);
      throw fail(502, `Beds24에서 예약 취소에 실패했습니다 (${describeBeds24Error(e)}). 네트워크 또는 권한을 확인하세요.`, { detail: String(e) });
    }
  }

  await prisma.event.delete({ where: { id: eventId } });

  // 취소된 예약의 자동 생성 청소를 바로 정리 (다음 동기화까지 기다리지 않도록).
  await ensureCleaningsForProperty(event.propertyId).catch(err => {
    console.error('[beds24/reservations] cleaning cleanup after cancel failed:', err);
  });

  return ok({ success: true });
});
