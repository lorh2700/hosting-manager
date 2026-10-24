import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { fail } from '@/lib/core/errors';

export interface ReservationBarrierSql {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
}
type Transaction = <T>(work: (db: ReservationBarrierSql) => Promise<T>) => Promise<T>;
type BarrierState = 'prepared' | 'sent' | 'held' | 'confirmed' | 'released' | 'needs_review';
interface Room {
  id: string; organization_id: string; property_id: string; beds24_room_id: string;
  beds24_property_id: string; beds24_connection_id: string; offer_id: number; version: number;
  property_room_id: string | null; property_beds24_id: string | null;
  connection_organization: string; provider: string; connection_state: string;
  secret_ref: string; credential_generation: number;
  active: boolean; current_organization: string | null;
}
interface SavedBarrier { id: string; room_id: string; from_date: string; to_exclusive: string; state: BarrierState; mapping: Record<string, unknown> }
export interface ReservationBarrierInput {
  roomId: number; propertyId?: string; offerId?: number; checkIn: string; checkOut: string;
  id?: string; requestHash?: string;
}
export interface ReservationBarrier { id: string; state: BarrierState; observedBookingId?: string }
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const directReservationMarker = (identity: unknown) => `legacy-reservation:${digest(identity)}`;
export const reservationRequestHash = digest;

const schemaQuery = `SELECT to_regclass('public.property_rooms') IS NOT NULL AS present,
  to_regclass('public.property_rooms') IS NOT NULL AND to_regclass('public.room_reservation_barriers') IS NOT NULL
  AND to_regclass('public.room_sales_blocks') IS NOT NULL AND to_regclass('public.calendar_changes') IS NOT NULL
  AND to_regclass('public.calendar_change_items') IS NOT NULL AND to_regclass('public.rate_connections') IS NOT NULL AS ready`;

export function createReservationBarrierStore(options: {
  transaction: Transaction;
  schema?: () => Promise<Array<{ present: boolean; ready: boolean }>>;
  environment?: () => { RATES_CONNECTION_SECRETS_JSON?: string };
  refreshToken?: () => string;
}) {
  async function available() {
    const [result] = options.schema ? await options.schema() : await options.transaction(db => db.$queryRawUnsafe<Array<{ present: boolean; ready: boolean }>>(schemaQuery));
    if (!result?.present) return false;
    if (!result.ready) throw fail(503, '요금·예약 연결 설정을 확인 중입니다.', { code: 'rate_schema_incomplete' });
    return true;
  }
  function dates(input: ReservationBarrierInput) {
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(input.checkIn) || !valid(input.checkOut) || input.checkOut <= input.checkIn || (Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86400000 > 366) throw fail(400, '예약 날짜를 확인해 주세요.');
  }
  async function room(db: ReservationBarrierSql, input: ReservationBarrierInput) {
    const found = await db.$queryRawUnsafe<Room[]>(`SELECT r.id,r.organization_id,r.property_id,r.beds24_room_id,r.beds24_property_id,
      r.beds24_connection_id,r.offer_id,r.version,r.active,p.organization_id AS current_organization,p.beds24_room_id AS property_room_id,p.beds24_prop_id AS property_beds24_id,
      c.organization_id AS connection_organization,c.provider,c.state AS connection_state,c.secret_ref,c.credential_generation
      FROM property_rooms r JOIN properties p ON p.id=r.property_id JOIN rate_connections c ON c.id=r.beds24_connection_id
      WHERE r.beds24_room_id=$1 OR p.beds24_room_id=$1 OR p.id=$2::text FOR UPDATE OF r`, String(input.roomId), input.propertyId || null);
    if (!found.length) return null;
    if (found.length !== 1) throw fail(409, '판매 객실 연결을 확인해 주세요.');
    const value = found[0];
    if (!value.active || value.current_organization !== value.organization_id || (input.propertyId && input.propertyId !== value.property_id) ||
      value.beds24_room_id !== String(input.roomId) || value.property_room_id !== value.beds24_room_id || value.property_beds24_id !== value.beds24_property_id ||
      value.connection_organization !== value.organization_id || value.provider !== 'beds24' || (input.offerId !== undefined && value.offer_id !== input.offerId)) throw fail(409, '예약과 요금 관리의 객실 연결이 다릅니다.', { code: 'rate_mapping_mismatch' });
    const environment = options.environment?.() || process.env;
    let secret: { generation?: number; refreshToken?: string } | undefined;
    try { secret = JSON.parse(environment.RATES_CONNECTION_SECRETS_JSON || '{}')[value.secret_ref]; } catch { /* Invalid server configuration stays closed. */ }
    if (value.connection_state !== 'ready' || !secret?.refreshToken || secret.generation !== value.credential_generation || secret.refreshToken !== (options.refreshToken?.() ?? BEDS24_REFRESH_TOKEN)) throw fail(503, '이 숙소의 예약 연결 검증이 필요합니다.', { code: 'rate_connection_mismatch' });
    return value;
  }
  function mapping(value: Room, requestHash?: string) {
    return { beds24RoomId: value.beds24_room_id, beds24PropertyId: value.beds24_property_id,
      connectionId: value.beds24_connection_id, credentialGeneration: value.credential_generation,
      offerId: value.offer_id, roomVersion: value.version, ...(requestHash ? { requestHash } : {}) };
  }
  async function checked(db: ReservationBarrierSql, value: Room, input: ReservationBarrierInput) {
    const blocked = await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM room_sales_blocks WHERE room_id=$1 AND active AND date>=$2::date AND date<$3::date LIMIT 1`, value.id, input.checkIn, input.checkOut);
    const pending = await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT c.id FROM calendar_changes c JOIN calendar_change_items i ON i.command_id=c.id
      WHERE c.room_id=$1 AND c.state IN ('queued','processing','delivery_pending','needs_review') AND i.date>=$2::date AND i.date<$3::date LIMIT 1`, value.id, input.checkIn, input.checkOut);
    const reservation = await db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM room_reservation_barriers WHERE room_id=$1 AND state IN ('prepared','sent','needs_review')
      AND from_date<$3::date AND to_exclusive>$2::date AND ($4::text IS NULL OR id<>$4) LIMIT 1`, value.id, input.checkIn, input.checkOut, input.id || null);
    if (blocked.length || pending.length || reservation.length) throw fail(409, '해당 날짜의 요금·판매·예약 상태를 확인 중입니다.', { code: 'sales_or_rate_pending' });
  }
  async function saved(db: ReservationBarrierSql, id: string) {
    return (await db.$queryRawUnsafe<SavedBarrier[]>('SELECT id,room_id,from_date::text,to_exclusive::text,state,mapping FROM room_reservation_barriers WHERE id=$1', id))[0];
  }
  function matches(row: SavedBarrier, value: Room, input: ReservationBarrierInput) {
    const { observedBookingId: _observed, ...original } = row.mapping;
    if (row.room_id !== value.id || row.from_date !== input.checkIn || row.to_exclusive !== input.checkOut || digest(original) !== digest(mapping(value, input.requestHash))) throw fail(409, '예약 처리 키 또는 객실 연결이 변경되었습니다.', { code: 'reservation_barrier_conflict' });
  }
  return {
    async check(input: ReservationBarrierInput) {
      if (!await available()) { if (input.id) throw fail(503, '예약 객실 연결이 변경되었습니다.'); return; }
      return options.transaction(async db => {
        const value = await room(db, input);
        if (!value) { if (input.id) throw fail(409, '예약 객실 연결이 변경되었습니다.'); return; }
        dates(input); await checked(db, value, input);
      });
    },
    async begin(input: ReservationBarrierInput): Promise<ReservationBarrier | null> {
      if (!await available()) return null;
      return options.transaction(async db => {
        const value = await room(db, input);
        if (!value) {
          if (input.id && await saved(db, input.id)) throw fail(409, '예약 객실 연결이 변경되었습니다.');
          return null;
        }
        dates(input);
        if (!input.id || input.id.length > 100 || !input.requestHash) throw fail(400, '예약 처리 키가 필요합니다.');
        const old = await saved(db, input.id);
        if (old) { matches(old, value, input); return { id: old.id, state: old.state, ...(typeof old.mapping.observedBookingId === 'string' ? { observedBookingId: old.mapping.observedBookingId } : {}) }; }
        await checked(db, value, input);
        await db.$executeRawUnsafe(`INSERT INTO room_reservation_barriers(id,room_id,organization_id,from_date,to_exclusive,state,mapping)
          VALUES($1,$2,$3,$4::date,$5::date,'prepared',$6::jsonb)`, input.id, value.id, value.organization_id, input.checkIn, input.checkOut, JSON.stringify(mapping(value, input.requestHash)));
        return { id: input.id, state: 'prepared' };
      });
    },
    async claimSend(input: ReservationBarrierInput) {
      if (!await available()) throw fail(503, '예약 객실 연결이 변경되었습니다.');
      return options.transaction(async db => {
        const value = await room(db, input); if (!value || !input.id) throw fail(409, '예약 객실 연결이 변경되었습니다.');
        const row = await saved(db, input.id); if (!row) throw fail(409, '예약 처리 키를 찾을 수 없습니다.');
        matches(row, value, input);
        if (row.state !== 'prepared') throw fail(409, '이 예약은 전송 여부를 확인해야 합니다. 다시 전송하지 않습니다.', { code: 'reservation_outcome_unknown' });
        await checked(db, value, input);
        await db.$executeRawUnsafe("UPDATE room_reservation_barriers SET state='sent',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND state='prepared'", input.id);
        return true;
      });
    },
    async finish(id: string, state: Exclude<BarrierState, 'prepared' | 'sent'>, observedId?: string) {
      if (!await available()) return;
      await options.transaction(async db => {
        const first = await saved(db, id); if (!first) return;
        await db.$queryRawUnsafe('SELECT id FROM property_rooms WHERE id=$1 FOR UPDATE', first.room_id);
        const current = await saved(db, id); if (!current || current.state === 'released') return;
        if (observedId && current.mapping.observedBookingId && current.mapping.observedBookingId !== observedId) throw fail(409, '이 처리 키에서 확인한 예약과 다릅니다.');
        if (current.state === 'confirmed' && state === 'held') return;
        await db.$executeRawUnsafe(`UPDATE room_reservation_barriers SET state=$2,mapping=mapping || $3::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id, state, JSON.stringify(observedId ? { observedBookingId: observedId } : {}));
      });
    },
  };
}

export const rateReservationBarriers = createReservationBarrierStore({
  transaction: work => prisma.$transaction(tx => work(tx), { maxWait: 5000, timeout: 10_000 }),
  // Absence is detected without querying a missing table, so old installations remain usable.
  schema: () => prisma.$queryRaw<Array<{ present: boolean; ready: boolean }>>`SELECT to_regclass('public.property_rooms') IS NOT NULL AS present,
    to_regclass('public.property_rooms') IS NOT NULL AND to_regclass('public.room_reservation_barriers') IS NOT NULL
    AND to_regclass('public.room_sales_blocks') IS NOT NULL AND to_regclass('public.calendar_changes') IS NOT NULL
    AND to_regclass('public.calendar_change_items') IS NOT NULL AND to_regclass('public.rate_connections') IS NOT NULL AS ready`,
});
