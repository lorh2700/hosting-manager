import { Prisma } from '../../generated/prisma/client';
import type { ReservationSummary } from '../contracts/reservations';

export type ReservationDatabase = Pick<Prisma.TransactionClient, 'property' | 'event' | 'booking' | 'cleaning' | 'message' | 'checkoutOrder' | 'guest' | 'guestReservation' | 'auditLog' | '$queryRaw' | '$executeRaw'>;
export interface ReservationListQuery { from: string; to: string; q: string; status: string; limit: number; offset: number }

export async function reservationRows(db: ReservationDatabase, propertyIds: string[], input: ReservationListQuery): Promise<ReservationSummary[]> {
  if (!propertyIds.length) return [];
  const ids = Prisma.join(propertyIds), pattern = `%${input.q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  return db.$queryRaw<ReservationSummary[]>(Prisma.sql`
    WITH stays AS (
      SELECT 'event:' || e.id AS id, e.property_id AS "propertyId", p.name AS "propertyName", e.title AS name,
        e.start_date AS "checkIn", e.end_date AS "checkOut", 'confirmed' AS status,
        COALESCE(e.source,e.channel_id) AS source, CASE WHEN e.num_adults IS NULL THEN NULL ELSE e.num_adults + COALESCE(e.num_children,0) END AS guests
      FROM events e JOIN properties p ON p.id=e.property_id
      WHERE e.property_id IN (${ids}) AND e.type='reservation' AND NOT ('inquiry'=ANY(e.tags)) AND (e.title IS NULL OR e.title NOT LIKE '[문의]%') AND e.start_date <= ${input.to} AND e.end_date >= ${input.from}
      UNION ALL
      SELECT 'booking:' || b.id, b.property_id, p.name, b.name, b.check_in, b.check_out, b.status, b.source, b.guests
      FROM bookings b JOIN properties p ON p.id=b.property_id
      WHERE b.property_id IN (${ids}) AND b.check_in <= ${input.to} AND b.check_out >= ${input.from}
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.property_id=b.property_id AND e.channel_id='beds24' AND e.original_uid=b.channel_booking_ref AND e.type='reservation' AND NOT ('inquiry'=ANY(e.tags)) AND (e.title IS NULL OR e.title NOT LIKE '[문의]%'))
    ) SELECT * FROM stays WHERE (${input.status}='all' OR status=${input.status})
      AND (${input.q}='' OR name ILIKE ${pattern} ESCAPE '\')
    ORDER BY "checkIn" DESC, id ASC LIMIT ${input.limit + 1} OFFSET ${input.offset}`);
}

export async function scopedGuestRows(db: ReservationDatabase, propertyIds: string[], query: { q: string; limit: number; offset: number }) {
  if (!propertyIds.length) return [];
  const pattern = `%${query.q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  return db.$queryRaw<Array<{ id: string; name: string | null; email: string | null; phone: string | null; reservationCount: number; lastCheckOut: string | null }>>(Prisma.sql`
    WITH visible AS (SELECT * FROM guest_reservations WHERE property_id IN (${Prisma.join(propertyIds)}) AND guest_id IS NOT NULL),
    matches AS (SELECT DISTINCT guest_id FROM visible WHERE ${query.q}='' OR name ILIKE ${pattern} ESCAPE '\' OR email ILIKE ${pattern} ESCAPE '\' OR phone ILIKE ${pattern} ESCAPE '\'),
    last_seen AS (SELECT DISTINCT ON (guest_id) guest_id AS id,name,email,phone FROM visible ORDER BY guest_id,check_in DESC,id DESC),
    totals AS (SELECT guest_id,COUNT(*)::int AS "reservationCount",MAX(check_out) AS "lastCheckOut" FROM visible GROUP BY guest_id)
    SELECT last_seen.*,totals."reservationCount",totals."lastCheckOut" FROM last_seen JOIN totals ON totals.guest_id=last_seen.id JOIN matches ON matches.guest_id=last_seen.id
    ORDER BY last_seen.name ASC NULLS LAST,last_seen.id ASC LIMIT ${query.limit + 1} OFFSET ${query.offset}`);
}

export interface GuestNote { organizationId: string; note: string; version: number }
export async function guestNotes(db: ReservationDatabase, guestId: string, organizationIds: string[]): Promise<GuestNote[]> {
  if (!organizationIds.length) return [];
  return db.$queryRaw<GuestNote[]>(Prisma.sql`SELECT organization_id AS "organizationId",note,version FROM backend_guest_notes WHERE guest_id=${guestId} AND organization_id IN (${Prisma.join(organizationIds)})`);
}
