export interface MobileBooking {
  id: string;
  title: string;
  start: string;
  end: string;
  type: 'reservation' | 'block';
  propertyName?: string;
  cleanerName?: string | null;
  cleaningDone?: boolean;
  color?: string;
}

export function dayBookings(events: MobileBooking[], date: string) {
  // Show departures as well as arrivals; blocks end exclusively.
  return events.filter(e => e.start <= date && (e.type === 'block' ? e.end > date : e.end >= date))
    .sort((a, b) => (a.propertyName || '').localeCompare(b.propertyName || '') ||
      Number(b.end === date) - Number(a.end === date) || a.start.localeCompare(b.start));
}

