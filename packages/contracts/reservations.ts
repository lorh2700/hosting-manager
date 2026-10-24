import { z } from 'zod';
import type { BackendRoute } from './backend-routes';

export const reservationDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '날짜를 확인해 주세요.');
export const reservationId = z.string().regex(/^(event|booking):[A-Za-z0-9_-]{1,90}$/);
const text = (max: number) => z.string().trim().max(max);
export const createReservationBody = z.object({
  propertyId: text(128).min(1), checkIn: reservationDay, checkOut: reservationDay,
  name: text(100).min(1), email: z.union([z.literal(''), z.email().max(200)]).default(''),
  phone: text(40).default(''), adults: z.number().int().min(1).max(10).default(2),
  children: z.number().int().min(0).max(9).default(0), notes: text(2000).default(''),
  tags: z.array(text(40).min(1)).max(20).default([]),
}).strict().refine(value => value.checkOut > value.checkIn &&
  Date.parse(value.checkOut) - Date.parse(value.checkIn) <= 365 * 86400000, '투숙 기간은 1박부터 365박까지 선택해 주세요.')
  .refine(value => value.adults + value.children <= 10, '투숙 인원은 10명까지 입력해 주세요.');
export type CreateReservationInput = z.infer<typeof createReservationBody>;
export const reservationBodySchemas = {
  createReservation: createReservationBody,
  recoverReservation: z.object({}).strict(),
  updateReservation: z.object({ version: text(100).min(1), notes: text(2000), tags: z.array(text(40).min(1)).max(20) }).strict(),
  cancelReservation: z.object({ version: text(100).min(1), reason: text(500).min(1) }).strict(),
  reservationInvitation: z.object({ language: z.enum(['ko', 'en', 'ja', 'zh']).default('ko') }).strict(),
  updateGuestNote: z.object({ organizationId: text(128).min(1), version: z.number().int().nonnegative(), note: text(2000) }).strict(),
  reviewGuest: z.object({ version: z.string().datetime(), action: z.enum(['link', 'new', 'ignore']), guestId: text(128).optional() }).strict()
    .refine(value => value.action !== 'link' || !!value.guestId, '연결할 고객을 선택해 주세요.'),
};

export const reservationRoutes: readonly BackendRoute[] = [
  { id: 'reservationCommands', method: 'GET', path: 'reservation-commands', module: 'reservations', summary: '본인의 최근 예약 처리와 미확정 요청 조회' },
  { id: 'reservations', method: 'GET', path: 'reservations', module: 'reservations', summary: '기간·숙소별 예약 목록' },
  { id: 'reservationAvailability', method: 'GET', path: 'reservations/availability', module: 'reservations', summary: '직접 예약 가용 여부 확인' },
  { id: 'reservationDetail', method: 'GET', path: 'reservations/:id', module: 'reservations', summary: '권한 내 예약 상세' },
  { id: 'createReservation', method: 'POST', path: 'reservations', module: 'reservations', mutation: true, summary: 'Beds24 확인을 거치는 직접 예약 등록' },
  { id: 'reservationCommand', method: 'GET', path: 'reservation-commands/:id', module: 'reservations', summary: '예약 등록·취소 처리 상태' },
  { id: 'recoverReservation', method: 'POST', path: 'reservation-commands/:id/reconcile', module: 'reservations', mutation: true, summary: '불확실한 예약 처리 결과 조회로 복구' },
  { id: 'updateReservation', method: 'PATCH', path: 'reservations/:id', module: 'reservations', mutation: true, summary: '예약 내부 메모·태그 변경' },
  { id: 'cancelReservation', method: 'POST', path: 'reservations/:id/cancel', module: 'reservations', mutation: true, summary: '직접 예약 취소 확인' },
  { id: 'reservationInvitation', method: 'POST', path: 'reservations/:id/invitation', module: 'reservations', mutation: true, summary: '개인화 초대 링크 생성' },
  { id: 'guests', method: 'GET', path: 'guests', module: 'reservations', summary: '관리 범위의 고객 명부' },
  { id: 'guestDetail', method: 'GET', path: 'guests/:id', module: 'reservations', summary: '고객의 범위 내 예약 이력' },
  { id: 'updateGuestNote', method: 'PATCH', path: 'guests/:id/note', module: 'reservations', mutation: true, summary: '사업자별 고객 메모 저장' },
  { id: 'guestReviews', method: 'GET', path: 'guest-reviews', module: 'reservations', summary: '고객 연결 검토 목록' },
  { id: 'reviewGuest', method: 'POST', path: 'guest-reviews/:id', module: 'reservations', mutation: true, summary: '범위 내 고객 연결 검토' },
];

export interface ReservationSummary {
  id: string; propertyId: string; propertyName: string; name: string | null;
  checkIn: string; checkOut: string; status: string; source: string | null; guests: number | null;
}
export interface ReservationDetail extends ReservationSummary {
  email: string | null; phone: string | null; notes: string; sourceNotes: string; tags: string[];
  version: string; beds24BookingId: string | null; canCancel: boolean; canInvite: boolean;
  cancellationReason: string | null; cleanings: Array<{ id: string; date: string; status: string; name: string | null }>;
  messages: Array<{ id: string; content: string; senderRole: string; createdAt: string }>; messagesAvailable: boolean;
}
export interface ReservationCommandResult {
  commandId: string; state: 'processing' | 'needs_review' | 'confirmed' | 'cancelled' | 'rejected';
  message: string; reservationId: string | null; beds24BookingId: string | null;
}
export interface GuestSummary {
  id: string; name: string | null; email: string | null; phone: string | null;
  reservationCount: number; lastCheckOut: string | null;
}
