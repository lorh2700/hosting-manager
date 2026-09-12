import { z } from 'zod';
import { beds24Get } from '@/lib/beds24';
import { fail } from '@/lib/core/http';
import { nextDay, type StayCalendar } from './stay-calendar';

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const rowSchema = z.object({
  from: isoDay, to: isoDay, numAvail: z.number().int().min(0),
  minStay: z.number().int().min(0), maxStay: z.number().int().min(0),
  override: z.enum(['none', 'blackout', 'exception', 'noCheckIn', 'noCheckOut', 'noCheckInOrCheckOut']),
});
const payloadSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({ roomId: z.number(), propertyId: z.number(), calendar: z.array(rowSchema) })),
});

export async function fetchStayCalendar(roomId: number, propertyId: number, start: string, end: string): Promise<StayCalendar> {
  try {
    const [raw, properties] = await Promise.all([
      beds24Get('/inventory/rooms/calendar', { roomId: String(roomId), startDate: start, endDate: end,
        includeNumAvail: 'true', includeMinStay: 'true', includeMaxStay: 'true', includeOverride: 'true' }),
      beds24Get('/properties', { id: String(propertyId), includeAllRooms: 'true' }),
    ]);
    const room = properties.data?.find((p: { id: number }) => p.id === propertyId)?.roomTypes?.find((r: { id: number }) => r.id === roomId);
    if (!room || !['firstNight', 'stayThrough'].includes(room.restrictionStrategy)) throw new Error('Missing room restrictions');
    const rows = payloadSchema.parse(raw).data.find(r => r.roomId === roomId && r.propertyId === propertyId)?.calendar;
    if (!rows) throw new Error('Missing calendar');
    const calendar: StayCalendar = { strategy: room.restrictionStrategy, days: {} };
    for (const row of rows) {
      const from = row.from < start ? start : row.from;
      const to = row.to > end ? end : row.to;
      for (let date = from; date <= to; date = nextDay(date)) {
        calendar.days[date] = { date, available: row.override === 'blackout' ? 0 : row.numAvail,
          minStay: Math.max(1, row.minStay), maxStay: row.maxStay || 365,
          arrival: !['blackout', 'noCheckIn', 'noCheckInOrCheckOut'].includes(row.override),
          departure: !['noCheckOut', 'noCheckInOrCheckOut'].includes(row.override) };
      }
    }
    // Missing dates must never be interpreted as an available room.
    for (let date = start; date <= end; date = nextDay(date)) {
      if (!calendar.days[date]) throw new Error('Incomplete calendar');
    }
    return calendar;
  } catch {
    throw fail(503, '예약 가능 날짜를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.');
  }
}
