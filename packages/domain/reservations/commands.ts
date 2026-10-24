import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { createReservationBody, reservationBodySchemas, reservationDay, type CreateReservationInput, type ReservationCommandResult } from '../../contracts/reservations';
import type { BackendIdentity } from '../identity/access';
import type { OperationsTransactionRunner } from '../operations/types';
import { auditData } from '../operations/audit';
import { createReservationService, parseReservationId } from './service';
import { matchesRemote, type RemoteReservation, type ReservationGateway } from './gateway';
import { listInput, reservationError, versionOf } from './policy';

interface StoredCommand { id: string; actor_id: string; property_id: string; operation: 'create' | 'cancel'; key_hash: string; body_hash: string; payload_ciphertext: string; state: string; external_id: string | null; reservation_id: string | null }
interface Payload { input?: CreateReservationInput; roomId: string; remotePropertyId: string; checkIn: string; checkOut: string; reservationId?: string; externalId?: string | null; reason?: string }
export interface ReservationCommandOptions {
  transaction: OperationsTransactionRunner;
  refreshActor: (tx: Prisma.TransactionClient, actor: BackendIdentity) => Promise<BackendIdentity | null>;
  gateway: ReservationGateway;
  encryptionSecret: string;
  invitationSecret: string;
  guestWebOrigin: string;
  now?: () => Date;
}
const terminal = (state: string) => ['confirmed', 'cancelled', 'rejected'].includes(state);
function canonical(value: unknown): string { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item); }
export function createReservationCommandService(options: ReservationCommandOptions) {
  const now = options.now || (() => new Date());
  const encryptionKey = Buffer.byteLength(options.encryptionSecret) >= 32 ? Buffer.from(hkdfSync('sha256', options.encryptionSecret, 'void-anchae', 'reservation-command-v1', 32)) : null;
  function encrypt(id: string, payload: Payload) {
    if (!encryptionKey) throw reservationError(503, 'COMMAND_SECRET_MISSING', '예약 요청 보관 설정을 확인해 주세요.');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce); cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function decrypt(command: StoredCommand): Payload {
    try {
      if (!encryptionKey) throw new Error('Missing key');
      const raw = Buffer.from(command.payload_ciphertext, 'base64url'), cipher = createDecipheriv('aes-256-gcm', encryptionKey, raw.subarray(0, 12));
      cipher.setAAD(Buffer.from(command.id)); cipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8')) as Payload;
    } catch { throw reservationError(503, 'COMMAND_UNREADABLE', '기존 예약 요청을 확인할 수 없습니다. 새로 등록하지 말고 관리자에게 문의해 주세요.'); }
  }
  function result(command: StoredCommand): ReservationCommandResult {
    const state = ['prepared', 'sent'].includes(command.state) ? 'processing' : command.state as ReservationCommandResult['state'];
    return { commandId: command.id, state, reservationId: command.reservation_id, beds24BookingId: command.external_id,
      message: state === 'confirmed' ? '예약 등록과 Beds24 반영을 확인했습니다.' : state === 'cancelled' ? '예약 취소를 확인했습니다.' : state === 'rejected' ? '예약 요청이 처리되지 않았습니다. 객실 가능 여부와 예약 조건을 확인해 주세요.' : '처리 결과를 확인하고 있습니다. 같은 예약을 새로 등록하지 말고 처리 결과를 다시 확인해 주세요.' };
  }
  async function current(tx: Prisma.TransactionClient, actor: BackendIdentity) {
    const latest = await options.refreshActor(tx, actor);
    if (!latest || latest.session.userId !== actor.session.userId || latest.user.status !== 'active' || latest.session.expiresAt * 1000 <= now().getTime()) throw reservationError(401, 'UNAUTHORIZED', '다시 로그인해 주세요.');
    return latest;
  }
  const service = (tx: Prisma.TransactionClient) => createReservationService(tx, options);
  async function authorize(tx: Prisma.TransactionClient, actor: BackendIdentity, command: StoredCommand) {
    const latest = await current(tx, actor);
    if (command.actor_id !== latest.user.id && latest.role !== 'super_admin') throw reservationError(404, 'NOT_FOUND', '예약 요청을 찾을 수 없습니다.');
    const [property] = await service(tx).scope(latest, { propertyId: command.property_id });
    return { latest, property };
  }
  async function load(tx: Prisma.TransactionClient, id: string): Promise<StoredCommand> {
    if (!/^[A-Za-z0-9_-]{1,90}$/.test(id)) throw reservationError(404, 'NOT_FOUND', '예약 요청을 찾을 수 없습니다.');
    const [command] = await tx.$queryRaw<StoredCommand[]>`SELECT * FROM backend_reservation_commands WHERE id=${id}`;
    if (!command) throw reservationError(404, 'NOT_FOUND', '예약 요청을 찾을 수 없습니다.');
    return command;
  }
  async function read(actor: BackendIdentity, id: string) { return options.transaction(async tx => { const command = await load(tx, id); await authorize(tx, actor, command); return result(command); }); }
  async function list(actor: BackendIdentity, query = new URLSearchParams()) {
    const input = listInput(query, now());
    return options.transaction(async tx => {
      const latest = await current(tx, actor), properties = await service(tx).scope(latest);
      if (!properties.length) return { items: [], hasMore: false, nextCursor: null };
      const rows = await tx.$queryRaw<StoredCommand[]>(Prisma.sql`SELECT * FROM backend_reservation_commands WHERE actor_id=${latest.user.id} AND property_id IN (${Prisma.join(properties.map(row => row.id))}) AND (state NOT IN ('confirmed','cancelled','rejected') OR created_at > CURRENT_TIMESTAMP - INTERVAL '1 day')
        ORDER BY CASE WHEN state IN ('confirmed','cancelled','rejected') THEN 1 ELSE 0 END,created_at DESC,id ASC LIMIT ${input.limit + 1} OFFSET ${input.offset}`);
      return { items: rows.slice(0, input.limit).map(row => ({ ...result(row), propertyId: row.property_id, propertyName: properties.find(property => property.id === row.property_id)!.name, operation: row.operation })), hasMore: rows.length > input.limit, nextCursor: rows.length > input.limit ? String(input.offset + input.limit) : null };
    });
  }
  async function availability(actor: BackendIdentity, query: URLSearchParams) {
    const propertyId = query.get('propertyId') || '', checkIn = query.get('checkIn') || '', checkOut = query.get('checkOut') || '';
    if (!propertyId || !reservationDay.safeParse(checkIn).success || !reservationDay.safeParse(checkOut).success || checkOut <= checkIn || Date.parse(checkOut) - Date.parse(checkIn) > 365 * 86400000) throw reservationError(400, 'INVALID_RANGE', '숙소와 1~365박 투숙 기간을 확인해 주세요.');
    const property = await options.transaction(async tx => { const latest = await current(tx, actor); return (await service(tx).scope(latest, { propertyId }))[0]; });
    if (!property.beds24RoomId || !property.beds24PropId || property.status !== 'active') throw reservationError(409, 'PROPERTY_NOT_READY', '활성 숙소의 Beds24 객실 연결을 확인해 주세요.');
    const response = await options.gateway.availability(String(property.beds24RoomId), String(property.beds24PropId), checkIn, checkOut);
    return { ...response, checkedAt: now().toISOString(), propertyId, checkIn, checkOut };
  }
  async function prepare(actor: BackendIdentity, operation: 'create' | 'cancel', key: string, raw: unknown, targetId: string | null) {
    if (!/^[\x21-\x7e]{16,200}$/.test(key)) throw reservationError(400, 'IDEMPOTENCY_KEY_REQUIRED', '예약 요청 식별키가 필요합니다.');
    const body = operation === 'create' ? createReservationBody.parse(raw) : reservationBodySchemas.cancelReservation.parse(raw);
    const keyHash = createHash('sha256').update(key).digest('hex'), bodyHash = versionOf(canonical({ targetId, body }));
    return options.transaction(async tx => {
      const latest = await current(tx, actor);
      // This transaction-scoped lock serializes a key before the first durable command exists.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${latest.user.id}:${operation}:${keyHash}`},0))`;
      const [previous] = await tx.$queryRaw<StoredCommand[]>`SELECT * FROM backend_reservation_commands WHERE actor_id=${latest.user.id} AND operation=${operation} AND key_hash=${keyHash}`;
      if (previous) { await authorize(tx, latest, previous); if (previous.body_hash !== bodyHash) throw reservationError(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 식별키로 다른 예약을 등록할 수 없습니다.'); return previous; }
      let payload: Payload, propertyId: string;
      if (operation === 'create') {
        const input = body as CreateReservationInput, [property] = await service(tx).scope(latest, { propertyId: input.propertyId });
        if (!property.beds24RoomId || !property.beds24PropId || property.status !== 'active') throw reservationError(409, 'PROPERTY_NOT_READY', '활성 숙소의 Beds24 객실 연결을 확인해 주세요.');
        if (input.adults + input.children > Math.min(10, property.maxGuests || 10)) throw reservationError(400, 'CAPACITY_EXCEEDED', '숙소의 최대 투숙 인원을 초과했습니다.');
        propertyId = property.id; payload = { input, roomId: String(property.beds24RoomId), remotePropertyId: String(property.beds24PropId), checkIn: input.checkIn, checkOut: input.checkOut };
      } else {
        if (!targetId) throw reservationError(400, 'INVALID_ID', '취소할 예약을 선택해 주세요.');
        const input = body as { version: string; reason: string }, detail = await service(tx).detail(latest, targetId);
        if (detail.version !== input.version) throw reservationError(409, 'VERSION_CONFLICT', '예약이 변경되었습니다. 다시 불러와 확인해 주세요.');
        if (!detail.canCancel) throw reservationError(409, 'CANCELLATION_UNAVAILABLE', detail.cancellationReason || '이 예약은 취소할 수 없습니다.');
        const [property] = await service(tx).scope(latest, { propertyId: detail.propertyId });
        propertyId = property.id; payload = { roomId: String(property.beds24RoomId || ''), remotePropertyId: String(property.beds24PropId || ''), checkIn: detail.checkIn, checkOut: detail.checkOut, reservationId: targetId, externalId: detail.beds24BookingId, reason: input.reason };
      }
      const id = randomUUID(), encrypted = encrypt(id, payload);
      await tx.$executeRaw`INSERT INTO backend_reservation_commands(id,actor_id,property_id,operation,key_hash,body_hash,payload_ciphertext) VALUES (${id},${latest.user.id},${propertyId},${operation},${keyHash},${bodyHash},${encrypted})`;
      return load(tx, id);
    });
  }
  async function state(actor: BackendIdentity, id: string, stateName: string, externalId: string | null = null) {
    return options.transaction(async tx => { const row = await load(tx, id); await authorize(tx, actor, row); if (!terminal(row.state)) await tx.$executeRaw`UPDATE backend_reservation_commands SET state=${stateName},external_id=COALESCE(${externalId},external_id),updated_at=CURRENT_TIMESTAMP WHERE id=${id} AND state NOT IN ('confirmed','cancelled','rejected')`; return load(tx, id); });
  }
  async function finalize(actor: BackendIdentity, id: string, remote: RemoteReservation | null) {
    return options.transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM backend_reservation_commands WHERE id=${id} FOR UPDATE`;
      const command = await load(tx, id), { latest, property } = await authorize(tx, actor, command), payload = decrypt(command);
      if (terminal(command.state)) return result(command);
      if (payload.roomId && String(property.beds24RoomId) !== payload.roomId) throw reservationError(409, 'ROOM_CHANGED', '숙소의 객실 연결이 변경되었습니다. Beds24 처리 결과를 관리자에게 확인해 주세요.');
      let reservationId: string | null = payload.reservationId || null;
      if (command.operation === 'create') {
        if (!payload.input || !matchesRemote(remote, { ...payload, marker: `void-staff:${id}` }) || remote!.status !== 'confirmed') throw reservationError(409, 'REMOTE_UNVERIFIED', '외부 예약을 확인하지 못했습니다.');
        const input = payload.input, externalId = remote!.id;
        const event = await tx.event.upsert({ where: { propertyId_channelId_originalUid: { propertyId: property.id, channelId: 'beds24', originalUid: externalId } },
          create: { propertyId: property.id, channelId: 'beds24', originalUid: externalId, source: 'manual-reservation', title: input.name, startDate: input.checkIn, endDate: input.checkOut, type: 'reservation', guestEmail: input.email || null, guestPhone: input.phone || null, numAdults: input.adults, numChildren: input.children, tags: input.tags }, update: {} });
        reservationId = `event:${event.id}`;
        await tx.$executeRaw`INSERT INTO backend_reservation_annotations(reservation_id,property_id,notes,tags,updated_by) VALUES(${reservationId},${property.id},${input.notes},${input.tags},${latest.user.id}) ON CONFLICT DO NOTHING`;
        const history = { propertyId: property.id, name: input.name, email: input.email || null, phone: input.phone || null, checkIn: input.checkIn, checkOut: input.checkOut, status: 'confirmed', source: 'manual-reservation', matchReason: 'staff-created-review', identitySignature: versionOf({ name: input.name, email: input.email, phone: input.phone }) };
        await tx.guestReservation.upsert({ where: { key: `${property.id}:beds24:${externalId}` }, create: { key: `${property.id}:beds24:${externalId}`, ...history }, update: { status: 'confirmed' } });
      } else {
        if (payload.externalId && (!matchesRemote(remote, { ...payload, id: payload.externalId }) || remote!.status !== 'cancelled')) throw reservationError(409, 'REMOTE_UNVERIFIED', '외부 예약 취소를 확인하지 못했습니다.');
        const ref = parseReservationId(payload.reservationId!);
        if (ref.kind === 'event') { await tx.event.deleteMany({ where: { id: ref.sourceId, propertyId: property.id, channelId: 'beds24', originalUid: payload.externalId || '' } }); reservationId = null; }
        else await tx.booking.updateMany({ where: { id: ref.sourceId, propertyId: property.id }, data: { status: 'cancelled' } });
        if (payload.externalId) {
          await tx.booking.updateMany({ where: { propertyId: property.id, channelBookingRef: payload.externalId }, data: { status: 'cancelled' } });
          await tx.event.deleteMany({ where: { propertyId: property.id, channelId: 'beds24', originalUid: payload.externalId } });
        }
        await tx.guestReservation.updateMany({ where: { propertyId: property.id, key: payload.externalId ? `${property.id}:beds24:${payload.externalId}` : `booking:${ref.sourceId}` }, data: { status: 'cancelled' } });
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
        if (payload.checkOut >= today) {
          // Keep completed/manual/partner records and assignee history. Only derived work without a remaining checkout is cancelled.
          await tx.$executeRaw`UPDATE cleanings SET status='cancelled',is_open=false WHERE property_id=${property.id} AND date=${payload.checkOut} AND origin='auto' AND status='pending' AND completed_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM events WHERE property_id=${property.id} AND type='reservation' AND end_date=${payload.checkOut} AND NOT ('inquiry'=ANY(tags)) AND (title IS NULL OR title NOT LIKE '[문의]%'))
            AND NOT EXISTS(SELECT 1 FROM bookings WHERE property_id=${property.id} AND status='confirmed' AND check_out=${payload.checkOut})`;
        }
      }
      const finalState = command.operation === 'create' ? 'confirmed' : 'cancelled';
      await tx.$executeRaw`UPDATE backend_reservation_commands SET state=${finalState},external_id=${remote?.id || payload.externalId || null},reservation_id=${reservationId},updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
      await tx.auditLog.create({ data: auditData(latest, { action: `reservation.${command.operation}`, module: 'reservations', organizationId: property.organizationId, propertyId: property.id, targetId: reservationId || payload.reservationId || id, targetType: 'reservation', summary: command.operation === 'create' ? 'Beds24 예약 등록을 확인했습니다.' : '예약 취소를 확인했습니다.' }) });
      return result(await load(tx, id));
    });
  }
  async function reconcile(actor: BackendIdentity, id: string) {
    const command = await options.transaction(async tx => { const row = await load(tx, id); await authorize(tx, actor, row); return row; });
    if (terminal(command.state)) return result(command);
    const payload = decrypt(command);
    if (command.operation === 'cancel' && !payload.externalId) return finalize(actor, id, null);
    let remote: RemoteReservation | null = null;
    try { remote = await options.gateway.find(payload.roomId, payload.checkIn, command.operation === 'create' ? `void-staff:${id}` : '', command.external_id || payload.externalId); } catch { /* An unverified read is not evidence that the write failed. */ }
    const verified = matchesRemote(remote, { ...payload, marker: command.operation === 'create' ? `void-staff:${id}` : undefined, id: payload.externalId }) && remote!.status === (command.operation === 'create' ? 'confirmed' : 'cancelled');
    if (verified) return finalize(actor, id, remote);
    return result(await state(actor, id, 'needs_review', remote?.id || command.external_id));
  }
  async function execute(actor: BackendIdentity, operation: 'create' | 'cancel', key: string, body: unknown, targetId: string | null = null) {
    const command = await prepare(actor, operation, key, body, targetId);
    if (terminal(command.state)) return result(command);
    if (command.state !== 'prepared') return reconcile(actor, command.id);
    const payload = decrypt(command);
    // Availability and external identity checks happen before claiming the single permitted POST.
    if (operation === 'create') {
      const available = await options.gateway.availability(payload.roomId, payload.remotePropertyId, payload.checkIn, payload.checkOut);
      if (!available.available) return result(await state(actor, command.id, 'rejected'));
    } else if (payload.externalId) {
      const remote = await options.gateway.find(payload.roomId, payload.checkIn, '', payload.externalId);
      if (!matchesRemote(remote, { ...payload, id: payload.externalId }) || remote!.channel) return result(await state(actor, command.id, 'rejected'));
      if (remote!.status === 'cancelled') return finalize(actor, command.id, remote);
    }
    const claimed = await options.transaction(async tx => {
      const row = await load(tx, command.id), { latest, property } = await authorize(tx, actor, row);
      if (payload.roomId && String(property.beds24RoomId) !== payload.roomId) throw reservationError(409, 'ROOM_CHANGED', '숙소의 객실 연결이 변경되었습니다.');
      if (operation === 'cancel') { const current = await service(tx).detail(latest, payload.reservationId!); if (!current.canCancel) throw reservationError(409, 'CANCELLATION_UNAVAILABLE', current.cancellationReason || '예약을 취소할 수 없습니다.'); }
      return (await tx.$executeRaw`UPDATE backend_reservation_commands SET state='sent',updated_at=CURRENT_TIMESTAMP WHERE id=${command.id} AND state='prepared'`) === 1;
    });
    if (!claimed) return reconcile(actor, command.id);
    let externalId: string | null = null;
    try {
      if (operation === 'create') {
        const response = await options.gateway.create(payload.input!, payload.roomId, `void-staff:${command.id}`);
        if (response.rejected) return result(await state(actor, command.id, 'rejected'));
        externalId = response.id || null;
      } else if (payload.externalId) await options.gateway.cancel(payload.externalId);
    } catch { /* Persisted sent state prevents a second POST after timeouts or process crashes. */ }
    await state(actor, command.id, 'needs_review', externalId);
    return reconcile(actor, command.id);
  }
  return { availability, read, list, reconcile, execute };
}
