import type { OpsMessage, OpsProperty } from '../app/api/ops/today/route';
import type { GuestFlag } from './ops-flags';

export interface TodayOverview {
  today: string;
  detailsLoaded?: boolean;
  unavailable?: string[];
  properties: OpsProperty[];
  cleaners: { id: string; name: string }[];
  cleanersLoaded?: boolean;
  counts: { pendingApplications: number | null; openIssues: number | null; pendingSupplies: number | null };
}

export interface TodayConversation {
  today: string;
  eventId: string;
  messages: OpsMessage[];
  flags: GuestFlag[];
  messagesAvailable: boolean;
}

/** Lazy reads cannot replace operational status or patch another day's guests. */
export function mergeTodayConversation<T extends TodayOverview>(current: T, incoming: TodayConversation): T {
  if (current.today !== incoming.today || !incoming.messagesAvailable) return current;
  let changed = false;
  const properties = current.properties.map(property => {
    const merge = (reservations: OpsProperty['checkins']) => reservations.map(reservation => {
      if (reservation.id !== incoming.eventId || !reservation.hasChat) return reservation;
      changed = true;
      return { ...reservation, messages: incoming.messages, flags: incoming.flags, messagesLoaded: true, messagesAvailable: true };
    });
    return { ...property, checkins: merge(property.checkins), checkouts: merge(property.checkouts) };
  });
  return changed ? { ...current, properties } : current;
}
