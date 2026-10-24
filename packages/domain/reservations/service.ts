import { Prisma } from '../../../generated/prisma/client';
import { normalizeIdentity } from '../../../lib/guest-history';
import { guestGuide } from '../../../lib/guest-guide';
import { createGuestLinkStore } from '../../../lib/guest-link-store';
import { guestInvitationPath } from '../../../lib/guest-invitation-url';
import { propertyAllowsModule } from '../../../lib/operational-access';
import { reservationId, reservationBodySchemas, type ReservationDetail } from '../../contracts/reservations';
import { guestNotes, reservationRows, scopedGuestRows, type ReservationDatabase } from '../../data/reservation-repository';
import type { BackendIdentity } from '../identity/access';
import { moduleAllowed } from '../reads/policy';
import { auditData } from '../operations/audit';
import { assertReservationAccess, listInput, reservationError, reservationPropertyWhere, versionOf } from './policy';

export const reservationPropertySelect = { id: true, name: true, status: true, organizationId: true, beds24RoomId: true,
  beds24PropId: true, maxGuests: true, slug: true, featureOverrides: true,
  organization: { select: { id: true, name: true, status: true, features: true } } } as const;
export type ReservationProperty = Prisma.PropertyGetPayload<{ select: typeof reservationPropertySelect }>;
export function parseReservationId(id: string) {
  if (!reservationId.safeParse(id).success) throw reservationError(400, 'INVALID_ID', '예약 식별자를 확인해 주세요.');
  const [kind, sourceId] = id.split(':');
  return { kind: kind as 'event' | 'booking', sourceId };
}
function page<T>(rows: T[], input: { limit: number; offset: number }) {
  return { items: rows.slice(0, input.limit), hasMore: rows.length > input.limit, nextCursor: rows.length > input.limit ? String(input.offset + input.limit) : null };
}

export function createReservationService(db: ReservationDatabase, options: { invitationSecret: string; guestWebOrigin: string; now?: () => Date }) {
  const now = options.now || (() => new Date());
  async function scope(actor: BackendIdentity, filter: { propertyId?: string; organizationId?: string } = {}) {
    assertReservationAccess(actor);
    const rows = await db.property.findMany({ where: { AND: [reservationPropertyWhere(actor),
      ...(filter.propertyId ? [{ id: filter.propertyId }] : []),
      ...(filter.organizationId ? [{ organizationId: filter.organizationId === '__unassigned__' ? null : filter.organizationId }] : [])] },
      select: reservationPropertySelect, orderBy: { id: 'asc' }, take: 1001 });
    const properties = rows.filter(row => actor.role === 'super_admin' || propertyAllowsModule(row, 'reservations'));
    if (rows.length > 1000) throw reservationError(400, 'RANGE_TOO_LARGE', '사업자나 숙소를 선택해 조회 범위를 줄여 주세요.');
    if (filter.propertyId && !properties.length) throw reservationError(404, 'NOT_FOUND', '숙소를 찾을 수 없습니다.');
    return properties;
  }
  async function owner(actor: BackendIdentity, id: string) {
    const ref = parseReservationId(id);
    const row = ref.kind === 'event' ? await db.event.findUnique({ where: { id: ref.sourceId } }) : await db.booking.findUnique({ where: { id: ref.sourceId } });
    if (!row) throw reservationError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');
    if (ref.kind === 'event' && 'type' in row && (row.type !== 'reservation' || row.tags.includes('inquiry') || row.title?.startsWith('[문의]'))) throw reservationError(404, 'NOT_FOUND', '확정된 투숙 예약이 아닙니다.');
    const [property] = await scope(actor, { propertyId: row.propertyId });
    return { ref, row, property };
  }
  async function detail(actor: BackendIdentity, id: string): Promise<ReservationDetail> {
    const { ref, property } = await owner(actor, id);
    const event = ref.kind === 'event' ? await db.event.findUniqueOrThrow({ where: { id: ref.sourceId } }) : null;
    const booking = ref.kind === 'booking' ? await db.booking.findUniqueOrThrow({ where: { id: ref.sourceId } }) : null;
    if (event && event.type !== 'reservation') throw reservationError(404, 'NOT_FOUND', '투숙 예약이 아닙니다.');
    const externalId = event?.channelId === 'beds24' ? event.originalUid : booking?.channelBookingRef ?? null;
    const end = event?.endDate || booking!.checkOut;
    const [annotation] = await db.$queryRaw<Array<{ notes: string; tags: string[]; version: number }>>`SELECT notes,tags,version FROM backend_reservation_annotations WHERE reservation_id=${id} AND property_id=${property.id}`;
    const paid = await db.checkoutOrder.findFirst({ where: { propertyId: property.id, status: { notIn: ['expired', 'refunded'] },
      OR: [...(booking ? [{ bookingId: booking.id }] : []), ...(externalId ? [{ beds24Id: externalId }] : [])] }, select: { id: true } });
    const source = event?.source || event?.channelId || booking?.source || null;
    const direct = ['manual-reservation', 'Beds24', 'beds24', 'direct'].includes(source || '');
    const messagesAvailable = moduleAllowed(actor, 'messages', property);
    const [cleanings, messages] = await Promise.all([
      moduleAllowed(actor, 'cleaning', property) ? db.cleaning.findMany({ where: { propertyId: property.id, date: end, origin: { not: 'interim' } }, take: 20,
        select: { id: true, date: true, status: true, externalCleanerName: true, cleaner: { select: { displayName: true } } } }) : [],
      messagesAvailable ? db.message.findMany({ where: { propertyId: property.id, OR: [
        ...(event ? [{ eventId: event.id }] : []), ...(externalId ? [{ beds24BookingId: externalId }] : [])] },
        orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, text: true, sender: true, createdAt: true } }) : [],
    ]);
    const active = !booking || booking.status === 'confirmed';
    const name = event?.title?.replace(/\s+예약$/, '') || booking?.name || null;
    return { id, propertyId: property.id, propertyName: property.name, name, checkIn: event?.startDate || booking!.checkIn, checkOut: end,
      status: event ? 'confirmed' : booking!.status, source, guests: event ? event.numAdults === null ? null : event.numAdults + (event.numChildren || 0) : booking!.guests,
      email: event?.guestEmail || booking?.email || null, phone: event?.guestPhone || booking?.phone || null,
      sourceNotes: event?.description || booking?.message || '', notes: annotation?.notes || '', tags: annotation?.tags || event?.tags || [],
      version: versionOf({ event, booking, annotation: annotation || null }), beds24BookingId: externalId,
      canCancel: direct && active && !paid && (!!externalId ? !!property.beds24RoomId : !!booking),
      cancellationReason: paid ? '온라인 결제 예약은 결제 관리에서 환불·취소해 주세요.' : !direct ? '외부 채널 예약은 해당 플랫폼에서 취소해 주세요.' : !active ? '확정된 예약이 아닙니다.' : null,
      canInvite: active && !!name && !!guestGuide(property.slug || '') && (!event || ['beds24', 'direct'].includes(event.channelId || '')) && Date.parse(`${end}T00:00:00+09:00`) + 30 * 86400000 > now().getTime(),
      cleanings: cleanings.map(row => ({ id: row.id, date: row.date, status: row.status, name: row.cleaner?.displayName || row.externalCleanerName })),
      messages: messages.map(row => ({ id: row.id, content: row.text, senderRole: row.sender, createdAt: row.createdAt.toISOString() })), messagesAvailable };
  }
  async function list(actor: BackendIdentity, query: URLSearchParams) {
    const input = listInput(query, now()), properties = await scope(actor, input);
    return { ...page(await reservationRows(db, properties.map(row => row.id), input), input),
      properties: properties.map(row => ({ id: row.id, name: row.name, maxGuests: row.maxGuests, canCreate: row.status === 'active' && !!row.beds24RoomId && !!row.beds24PropId })) };
  }
  async function update(actor: BackendIdentity, id: string, body: unknown) {
    const input = reservationBodySchemas.updateReservation.parse(body), current = await detail(actor, id);
    if (current.version !== input.version) throw reservationError(409, 'VERSION_CONFLICT', '예약 정보가 변경되었습니다. 다시 불러온 뒤 저장해 주세요.');
    await db.$executeRaw`INSERT INTO backend_reservation_annotations (reservation_id,property_id,notes,tags,updated_by) VALUES (${id},${current.propertyId},${input.notes},${input.tags},${actor.user.id}) ON CONFLICT(reservation_id) DO UPDATE SET notes=EXCLUDED.notes,tags=EXCLUDED.tags,version=backend_reservation_annotations.version+1,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`;
    const [property] = await scope(actor, { propertyId: current.propertyId });
    await db.auditLog.create({ data: auditData(actor, { action: 'reservation.annotate', module: 'reservations', organizationId: property.organizationId, propertyId: current.propertyId, targetId: id, targetType: 'reservation', summary: '예약 내부 메모와 태그를 변경했습니다.' }) });
    return detail(actor, id);
  }
  async function invitation(actor: BackendIdentity, id: string, body: unknown) {
    const input = reservationBodySchemas.reservationInvitation.parse(body), current = await detail(actor, id), ref = parseReservationId(id);
    if (!current.canInvite) throw reservationError(409, 'INVITATION_UNAVAILABLE', '초대 링크를 만들 수 있는 확정 예약과 숙소 안내를 확인해 주세요.');
    if (!/^https?:\/\//.test(options.guestWebOrigin)) throw reservationError(503, 'INVITATION_UNAVAILABLE', '초대 링크 설정을 확인해 주세요.');
    const expires = Math.min(now().getTime() + 365 * 86400000, Date.parse(`${current.checkOut}T00:00:00+09:00`) + 30 * 86400000);
    const token = await createGuestLinkStore(db).issueInvitation({ kind: ref.kind, id: ref.sourceId, propertyId: current.propertyId, expires });
    const [property] = await scope(actor, { propertyId: current.propertyId });
    await db.auditLog.create({ data: auditData(actor, { action: 'reservation.invitation.create', module: 'reservations', organizationId: property.organizationId, propertyId: current.propertyId, targetId: id, targetType: 'reservation', summary: '게스트 초대 링크를 생성했습니다.' }) });
    return { url: new URL(guestInvitationPath(token, input.language), options.guestWebOrigin).toString(), expiresAt: new Date(expires).toISOString() };
  }
  async function guests(actor: BackendIdentity, query: URLSearchParams) {
    const input = listInput(query, now()), properties = await scope(actor, input);
    return page(await scopedGuestRows(db, properties.map(row => row.id), input), input);
  }
  async function guestDetail(actor: BackendIdentity, id: string, query: URLSearchParams) {
    const input = listInput(query, now()), properties = await scope(actor, input), ids = properties.map(row => row.id);
    const where = { guestId: id, propertyId: { in: ids } };
    const current = await db.guestReservation.findFirst({ where, orderBy: [{ checkIn: 'desc' }, { id: 'desc' }], select: { name: true, email: true, phone: true } });
    if (!current) throw reservationError(404, 'NOT_FOUND', '고객을 찾을 수 없습니다.');
    const rows = await db.guestReservation.findMany({ where, orderBy: [{ checkIn: 'desc' }, { id: 'asc' }], take: input.limit + 1, skip: input.offset,
      select: { id: true, propertyId: true, checkIn: true, checkOut: true, status: true, source: true, matchStatus: true } });
    const historyScope = await db.guestReservation.findMany({ where, distinct: ['propertyId'], select: { propertyId: true }, take: 1001 });
    const organizations = [...new Set(historyScope.map(row => properties.find(property => property.id === row.propertyId)?.organizationId || '__unassigned__'))];
    const notes = await guestNotes(db, id, organizations);
    return { guest: { id, ...current }, ...page(rows.map(row => ({ ...row, propertyName: properties.find(property => property.id === row.propertyId)?.name || '' })), input),
      notes: organizations.map(organizationId => ({ organizationId, organizationName: properties.find(property => (property.organizationId || '__unassigned__') === organizationId)?.organization?.name || '소속 미지정', note: notes.find(note => note.organizationId === organizationId)?.note || '', version: notes.find(note => note.organizationId === organizationId)?.version || 0 })) };
  }
  async function updateGuestNote(actor: BackendIdentity, id: string, body: unknown) {
    const input = reservationBodySchemas.updateGuestNote.parse(body), properties = await scope(actor, { organizationId: input.organizationId });
    if (!await db.guestReservation.findFirst({ where: { guestId: id, propertyId: { in: properties.map(row => row.id) } }, select: { id: true } })) throw reservationError(404, 'NOT_FOUND', '고객을 찾을 수 없습니다.');
    const saved = input.version === 0 ? await db.$executeRaw`INSERT INTO backend_guest_notes (organization_id,guest_id,note,updated_by) VALUES (${input.organizationId},${id},${input.note},${actor.user.id}) ON CONFLICT DO NOTHING`
      : await db.$executeRaw`UPDATE backend_guest_notes SET note=${input.note},version=version+1,updated_by=${actor.user.id},updated_at=CURRENT_TIMESTAMP WHERE organization_id=${input.organizationId} AND guest_id=${id} AND version=${input.version}`;
    if (saved !== 1) throw reservationError(409, 'VERSION_CONFLICT', '고객 메모가 변경되었습니다. 다시 불러와 확인해 주세요.');
    await db.auditLog.create({ data: auditData(actor, { action: 'guest.note.update', module: 'reservations', organizationId: input.organizationId === '__unassigned__' ? null : input.organizationId, targetType: 'guest', targetId: id, summary: '고객 메모를 변경했습니다.' }) });
    return { saved: true, version: input.version + 1 };
  }
  async function reviews(actor: BackendIdentity, query: URLSearchParams) {
    const input = listInput(query, now()), properties = await scope(actor, input);
    const rows = await db.guestReservation.findMany({ where: { propertyId: { in: properties.map(row => row.id) }, matchStatus: 'review' }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: input.limit + 1, skip: input.offset,
      select: { id: true, propertyId: true, name: true, email: true, phone: true, checkIn: true, checkOut: true, source: true, updatedAt: true, candidateIds: true } });
    const candidateIds = [...new Set(rows.flatMap(row => row.candidateIds))];
    const candidates = candidateIds.length ? await db.guestReservation.findMany({ where: { propertyId: { in: properties.map(row => row.id) }, guestId: { in: candidateIds } }, distinct: ['guestId'], take: 1000, select: { guestId: true, name: true, email: true, phone: true } }) : [];
    return page(rows.map(row => ({ id: row.id, propertyId: row.propertyId, propertyName: properties.find(property => property.id === row.propertyId)?.name || '', name: row.name, email: row.email, phone: row.phone, checkIn: row.checkIn, checkOut: row.checkOut, source: row.source, version: row.updatedAt.toISOString(),
      candidates: candidates.filter(candidate => row.candidateIds.includes(candidate.guestId!)).map(candidate => ({ id: candidate.guestId!, name: candidate.name, email: candidate.email, phone: candidate.phone })) })), input);
  }
  async function review(actor: BackendIdentity, id: string, body: unknown) {
    const input = reservationBodySchemas.reviewGuest.parse(body), properties = await scope(actor);
    const row = await db.guestReservation.findFirst({ where: { id, propertyId: { in: properties.map(property => property.id) } } });
    if (!row) throw reservationError(404, 'NOT_FOUND', '검토할 예약을 찾을 수 없습니다.');
    if (row.updatedAt.toISOString() !== input.version || row.matchStatus !== 'review') throw reservationError(409, 'VERSION_CONFLICT', '다른 담당자가 검토했습니다. 다시 불러와 주세요.');
    let guestId: string | null = null;
    if (input.action === 'link') {
      if (!row.candidateIds.includes(input.guestId!) || !await db.guestReservation.findFirst({ where: { guestId: input.guestId, propertyId: { in: properties.map(property => property.id) } }, select: { id: true } })) throw reservationError(404, 'NOT_FOUND', '현재 관리 범위에 있는 연결 후보를 선택해 주세요.');
      guestId = input.guestId!;
    } else if (input.action === 'new') guestId = (await db.guest.create({ data: { name: row.name, email: row.email, phone: row.phone, source: row.source, ...normalizeIdentity(row) }, select: { id: true } })).id;
    const updated = await db.guestReservation.updateMany({ where: { id, updatedAt: row.updatedAt, matchStatus: 'review' }, data: { guestId, matchStatus: input.action === 'ignore' ? 'ignored' : 'manual', matchReason: `staff-${input.action}`, reviewedBy: actor.user.id, reviewedAt: now() } });
    if (updated.count !== 1) throw reservationError(409, 'VERSION_CONFLICT', '다른 담당자가 검토했습니다. 다시 불러와 주세요.');
    await db.auditLog.create({ data: auditData(actor, { action: 'guest.review', module: 'reservations', organizationId: properties.find(property => property.id === row.propertyId)?.organizationId || null, propertyId: row.propertyId, targetId: id, targetType: 'guestReservation', summary: '예약의 고객 연결을 검토했습니다.' }) });
    return { saved: true, guestId };
  }
  async function authorizeCommand(actor: BackendIdentity, operation: string, targetId: string | null, body: unknown) {
    assertReservationAccess(actor);
    if (!targetId) throw reservationError(400, 'INVALID_ID', '대상을 선택해 주세요.');
    if (['updateReservation', 'reservationInvitation'].includes(operation)) { await owner(actor, targetId); return; }
    const input = body && typeof body === 'object' ? body as { organizationId?: string } : {};
    if (operation === 'updateGuestNote' && !input.organizationId) throw reservationError(400, 'INVALID_TARGET', '메모를 남길 사업자를 확인해 주세요.');
    const properties = await scope(actor, operation === 'updateGuestNote' ? { organizationId: input.organizationId } : {});
    const found = await db.guestReservation.findFirst({ where: { propertyId: { in: properties.map(item => item.id) },
      ...(operation === 'updateGuestNote' ? { guestId: targetId } : { id: targetId }) }, select: { id: true } });
    if (!found) throw reservationError(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.');
  }
  return { scope, owner, list, detail, update, invitation, guests, guestDetail, updateGuestNote, reviews, review, authorizeCommand };
}
export type ReservationService = ReturnType<typeof createReservationService>;
