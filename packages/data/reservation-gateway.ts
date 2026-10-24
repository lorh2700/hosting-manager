import { beds24Get, beds24Post } from '../../lib/beds24';
import { fetchStayCalendar } from '../../lib/beds24-stay-calendar';
import { calendarAvailability, type RemoteReservation, type ReservationGateway } from '../domain/reservations/gateway';

type Row = Record<string, unknown>;
function remote(row: Row): RemoteReservation {
  return { id: String(row.id), roomId: String(row.roomId), checkIn: String(row.arrival || '').slice(0, 10), checkOut: String(row.departure || '').slice(0, 10),
    status: String(row.status || ''), marker: String(row.custom1 || ''), channel: String(row.channel || row.apiReference || ''), name: [row.firstName, row.lastName].filter(Boolean).join(' ') };
}
// A creation timeout is ambiguous. This adapter never retries a POST; recovery only reads.
export function createBeds24ReservationGateway(): ReservationGateway {
  return {
    availability: async (roomId, propertyId, checkIn, checkOut) => calendarAvailability(await fetchStayCalendar(Number(roomId), Number(propertyId), checkIn, checkOut), checkIn, checkOut),
    create: async (input, roomId, marker) => {
      const raw = await beds24Post('/bookings', [{ roomId: Number(roomId), arrival: input.checkIn, departure: input.checkOut, roomQty: 1,
        firstName: input.name, lastName: '', email: input.email, phone: input.phone, numAdult: input.adults, numChild: input.children,
        status: 'confirmed', custom1: marker, actions: { checkAvailability: true, notifyGuest: false, notifyHost: false } }], { timeoutMs: 7000, noRetry: true });
      const result = Array.isArray(raw) && raw.length === 1 ? raw[0] : null;
      if (result?.success === false) return { rejected: true };
      const id = Number(result?.new?.id);
      return result?.success === true && Number.isSafeInteger(id) && id > 0 ? { id: String(id) } : {};
    },
    find: async (roomId, checkIn, marker, id) => {
      if (id) {
        const raw = await beds24Get('/bookings', { id }, { timeoutMs: 6000 });
        if (raw.success !== true || !Array.isArray(raw.data)) throw new Error('Unverified booking lookup');
        const row = (raw.data as Row[]).find(row => String(row.id) === id);
        return row ? remote(row) : null;
      }
      const found: RemoteReservation[] = [];
      for (let page = 1; page <= 5; page++) {
        const raw = await beds24Get('/bookings', { roomId, arrivalFrom: checkIn, arrivalTo: checkIn, page: String(page) }, { timeoutMs: 6000 });
        if (raw.success !== true || !Array.isArray(raw.data)) throw new Error('Unverified booking lookup');
        found.push(...(raw.data as Row[]).filter(row => row.custom1 === marker).map(remote));
        if (!raw.pages?.nextPageExists) return found.length === 1 ? found[0] : null;
      }
      throw new Error('Booking lookup exceeded safe result limit');
    },
    cancel: async id => { await beds24Post('/bookings', [{ id: Number(id), status: 'cancelled', actions: { notifyGuest: false, notifyHost: false } }], { timeoutMs: 7000, noRetry: true }); },
  };
}
