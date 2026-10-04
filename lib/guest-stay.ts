import { z } from 'zod';

export const guestStayKinds = ['tour', 'taxi', 'help'] as const;
export const guestStayStatuses = ['requested', 'reviewing', 'confirmed', 'completed', 'cancelled'] as const;
export type GuestStayRequestStatus = typeof guestStayStatuses[number];
export const guestStayTransitions: Record<GuestStayRequestStatus, readonly GuestStayRequestStatus[]> = {
  requested: ['reviewing', 'confirmed', 'cancelled'], reviewing: ['confirmed', 'completed', 'cancelled'],
  confirmed: ['reviewing', 'completed', 'cancelled'], completed: [], cancelled: [],
};
export const guestStayDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const date = guestStayDateSchema;
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const note = z.string().trim().max(1000).default('');
export const tourDetailsSchema = z.object({ tourId: z.string().uuid(), date, time, guests: z.number().int().min(1).max(12),
  durationOptionId: z.string().uuid().optional(), ticketCounts: z.record(z.string().uuid(), z.number().int().min(0).max(12)).optional(), note }).strict();
export const taxiDetailsSchema = z.object({ date, time, destination: z.string().trim().min(1).max(300),
  passengers: z.number().int().min(1).max(12), luggage: z.number().int().min(0).max(30), note }).strict();
export const helpDetailsSchema = z.object({ category: z.enum(['supplies', 'issue', 'other']), message: z.string().trim().min(1).max(2000) }).strict();
export const guestStayRequestSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().uuid(), kind: z.literal('tour'), details: tourDetailsSchema }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('taxi'), details: taxiDetailsSchema }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('help'), details: helpDetailsSchema }).strict(),
]);
export type GuestStayRequestInput = z.infer<typeof guestStayRequestSchema>;
export type GuestStayRequestDTO = {
  id: string; kind: typeof guestStayKinds[number]; status: GuestStayRequestStatus;
  details: GuestStayRequestInput['details']; publicReply: string; source: 'mobile' | 'pad';
  createdAt: string; updatedAt: string; version: number;
  tourTitle?: string; durationTitle?: string;
  tourSnapshot?: { title: string; durationTitle: string; price: number | null;
    pricingBasis: 'course' | 'tickets' | 'reference'; ticketSelections: { id: string; label: string; count: number; unitPrice: number }[] };
};
export type GuestStayPropertyDTO = {
  id: string; slug: string; name: string; nameEn: string; image: string;
  checkInTime: string; checkOutTime: string; address: string; addressEn: string; region: string;
};
export type GuestStayDTO = {
  property: GuestStayPropertyDTO; guestName: string; checkIn: string; checkOut: string;
  guests: number | null; phase: 'before_arrival' | 'staying'; expiresAt: string;
  room: { wifiSsid: string; wifiPassword: string; wifiEncryption: string } | null;
  requests: GuestStayRequestDTO[];
};
export const guestStayLoginSchema = z.object({ slug: z.string().regex(/^[a-z0-9_-]{1,60}$/),
  name: z.string().trim().min(1).max(100), code: z.string().max(40).optional(),
  invitation: z.string().max(1024).optional(), accessToken: z.string().max(128).optional(),
}).strict().refine(value => [value.code, value.invitation, value.accessToken].filter(Boolean).length === 1);

/** Names supplement an unguessable reservation credential; they never select a reservation. */
export function normalizeGuestStayName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
}
export function guestStayBounds(checkIn: string, checkOut: string, checkInTime = '15:00', checkOutTime = '11:00') {
  const start = Date.parse(`${checkIn}T${checkInTime}:00+09:00`);
  const end = Date.parse(`${checkOut}T${checkOutTime}:00+09:00`);
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
}
export function guestStayPhase(checkIn: string, checkOut: string, now = Date.now(), checkInTime = '15:00', checkOutTime = '11:00') {
  const bounds = guestStayBounds(checkIn, checkOut, checkInTime, checkOutTime);
  if (!bounds || now >= bounds.end) return null;
  return now < bounds.start ? 'before_arrival' as const : 'staying' as const;
}
export function requestDateWithinStay(value: { date: string; time: string }, stay: { checkIn: string; checkOut: string }, now: number,
  checkOutTime = '11:00', allowAtCheckout = false) {
  const at = Date.parse(`${value.date}T${value.time}:00+09:00`);
  const end = Date.parse(`${stay.checkOut}T${checkOutTime}:00+09:00`);
  return Number.isFinite(at) && at > now && value.date >= stay.checkIn && value.date <= stay.checkOut &&
    (allowAtCheckout ? at <= end : at < end);
}
