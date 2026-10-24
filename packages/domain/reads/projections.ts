import { nightsBetween } from '../../../lib/ops-flags';

export interface EventReadRow {
  id: string;
  propertyId: string;
  channelId: string | null;
  source: string | null;
  title: string | null;
  startDate: string;
  endDate: string;
  type: string;
  originalUid: string | null;
  numAdults: number | null;
  numChildren: number | null;
}

export interface BookingReadRow {
  id: string;
  propertyId: string;
  name: string | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  source: string;
  channelBookingRef: string | null;
  checkout: { beds24Id: string | null; stayOptions: unknown } | null;
}

export interface CleaningReadRow {
  id: string;
  propertyId: string;
  date: string;
  cleanerId: string | null;
  status: string;
  origin: string;
  cleaner: { displayName: string | null } | null;
  externalCleanerName: string | null;
}

export interface StaySummary {
  id: string;
  sourceType: 'event' | 'booking';
  sourceId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  label: string;
  type: string;
  status: string;
  guests: number | null;
  pets: number | null;
  channel: string | null;
  nights: number;
  cleaningId: string | null;
  cleaningMatch: 'matched' | 'none' | 'ambiguous' | 'not_permitted' | 'not_applicable' | 'deferred';
}

function petsFromSnapshot(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const options = value as { version?: unknown; pets?: unknown };
  return options.version === 1 && typeof options.pets === 'number' && Number.isInteger(options.pets) && options.pets >= 0 && options.pets <= 2 ? options.pets : null;
}

function references(booking: BookingReadRow): string[] {
  return [...new Set([booking.channelBookingRef, booking.checkout?.beds24Id].filter((value): value is string => !!value))];
}

export function projectStays(events: EventReadRow[], bookings: BookingReadRow[], cleaner: boolean): StaySummary[] {
  const bookingByReference = new Map<string, BookingReadRow[]>();
  for (const booking of bookings) for (const ref of references(booking)) {
    const key = `${booking.propertyId}:${ref}`;
    bookingByReference.set(key, [...(bookingByReference.get(key) ?? []), booking]);
  }
  const linkedBookings = new Set<string>();
  const stays: StaySummary[] = events.map(event => {
    const linked = event.channelId === 'beds24' && event.originalUid
      ? bookingByReference.get(`${event.propertyId}:${event.originalUid}`) ?? [] : [];
    for (const booking of linked) linkedBookings.add(booking.id);
    const count = (event.numAdults ?? 0) + (event.numChildren ?? 0);
    return {
      id: `event:${event.id}`, sourceType: 'event', sourceId: event.id, propertyId: event.propertyId,
      checkIn: event.startDate, checkOut: event.endDate,
      label: cleaner ? (event.type === 'reservation' ? '투숙 일정' : '예약 불가') : event.title || '게스트',
      type: event.type, status: event.type === 'reservation' ? 'confirmed' : 'blocked',
      guests: count > 0 ? count : null, pets: linked.length === 1 ? petsFromSnapshot(linked[0].checkout?.stayOptions) : null,
      channel: cleaner ? null : event.source || event.channelId,
      nights: nightsBetween(event.startDate, event.endDate), cleaningId: null, cleaningMatch: 'none',
    };
  });
  for (const booking of bookings) {
    if (linkedBookings.has(booking.id)) continue;
    stays.push({ id: `booking:${booking.id}`, sourceType: 'booking', sourceId: booking.id, propertyId: booking.propertyId,
      checkIn: booking.checkIn, checkOut: booking.checkOut, label: cleaner ? '투숙 일정' : booking.name || '게스트',
      type: 'reservation', status: 'confirmed', guests: booking.guests, pets: petsFromSnapshot(booking.checkout?.stayOptions),
      channel: cleaner ? null : booking.source, nights: nightsBetween(booking.checkIn, booking.checkOut), cleaningId: null, cleaningMatch: 'none' });
  }
  return stays.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id));
}

export function attachCleaning(stays: StaySummary[], rows: CleaningReadRow[], permittedIds: Set<string>): void {
  const byDate = new Map<string, CleaningReadRow[]>();
  for (const row of rows) {
    const key = `${row.propertyId}:${row.date}`;
    byDate.set(key, [...(byDate.get(key) ?? []), row]);
  }
  for (const stay of stays) {
    if (stay.type !== 'reservation') { stay.cleaningMatch = 'not_applicable'; continue; }
    if (!permittedIds.has(stay.propertyId)) { stay.cleaningMatch = 'not_permitted'; continue; }
    const matches = byDate.get(`${stay.propertyId}:${stay.checkOut}`) ?? [];
    stay.cleaningId = matches.length === 1 ? matches[0].id : null;
    stay.cleaningMatch = matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'matched' : 'none';
  }
}

export function projectCleaning(row: CleaningReadRow) {
  return { id: row.id, propertyId: row.propertyId, date: row.date, status: row.status, origin: row.origin,
    assignee: row.cleanerId ? { id: row.cleanerId, name: row.cleaner?.displayName || '담당자' }
      : row.externalCleanerName ? { id: null, name: row.externalCleanerName } : null };
}
