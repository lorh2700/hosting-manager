import type { CreateReservationInput } from '../../contracts/reservations';
import type { StayCalendar } from '../../../lib/stay-calendar';

export interface RemoteReservation { id: string; roomId: string; checkIn: string; checkOut: string; status: string; marker: string; channel: string; name: string }
export interface ReservationGateway {
  availability(roomId: string, propertyId: string, checkIn: string, checkOut: string): Promise<{ available: boolean; reason: string | null }>;
  create(input: CreateReservationInput, roomId: string, marker: string): Promise<{ id?: string; rejected?: boolean }>;
  find(roomId: string, checkIn: string, marker: string, id?: string | null): Promise<RemoteReservation | null>;
  cancel(id: string): Promise<void>;
}
export function calendarAvailability(calendar: StayCalendar, checkIn: string, checkOut: string) {
  const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000;
  if (nights < 1 || nights > 365) return { available: false, reason: '투숙 기간은 1박부터 365박까지 선택해 주세요.' };
  if (!calendar.days[checkIn]?.arrival) return { available: false, reason: '체크인이 제한된 날짜입니다.' };
  if (!calendar.days[checkOut]?.departure) return { available: false, reason: '체크아웃 가능 여부를 확인해 주세요.' };
  for (let date = checkIn; date < checkOut; date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)) {
    const day = calendar.days[date];
    if (!day || day.available < 1) return { available: false, reason: '일정 중 예약 가능한 객실이 없는 날짜가 있습니다.' };
    if ((date === checkIn || calendar.strategy === 'stayThrough') && (nights < day.minStay || nights > day.maxStay)) return { available: false, reason: `선택한 날짜의 투숙 가능 기간은 ${day.minStay}박부터 ${day.maxStay}박까지입니다.` };
  }
  return { available: true, reason: null };
}
export function matchesRemote(remote: RemoteReservation | null, expected: { roomId: string; checkIn: string; checkOut: string; marker?: string; id?: string | null }) {
  return !!remote && remote.roomId === expected.roomId && remote.checkIn === expected.checkIn && remote.checkOut === expected.checkOut &&
    (!expected.marker || remote.marker === expected.marker) && (!expected.id || remote.id === expected.id);
}
