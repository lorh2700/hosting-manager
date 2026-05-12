import { z } from 'zod';

// v1 외부 API 공통 스키마 + serializer.
//
// 책임:
//   • Zod 로 입력 (POST/PATCH body, query string) 검증
//   • Prisma row → v1 응답 형식 변환 (camelCase 유지, 내부 필드 숨기기)
//
// 응답 일관성 규칙:
//   • 날짜는 YYYY-MM-DD 또는 ISO 8601 datetime (timezone 명시)
//   • null = 정보 없음, undefined 는 응답에 절대 노출하지 않음
//   • 목록은 { items: [...] } 형태 (향후 pagination 추가 여지)

// ─────────────────────────────────────────────────────────────────────────
// Common helpers
// ─────────────────────────────────────────────────────────────────────────

export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const dateRangeRefine = (data: { from?: string; to?: string }) =>
  !data.from || !data.to || data.from <= data.to;

export const dateRangeQuerySchema = z
  .object({
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
  })
  .refine(dateRangeRefine, { message: 'from must be <= to' });

// ─────────────────────────────────────────────────────────────────────────
// Bookings (Event + Booking unified)
// ─────────────────────────────────────────────────────────────────────────

export const bookingStatusSchema = z.enum(['confirmed', 'inquiry', 'cancelled', 'pending']);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const bookingsQuerySchema = z
  .object({
    propertyId: z.string().uuid().optional(),
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
    status: bookingStatusSchema.optional(),
    source: z.string().optional(),       // 'stayfolio', 'airbnb', 'direct', ...
    limit: z.coerce.number().int().positive().max(500).optional().default(100),
  })
  .refine(dateRangeRefine, { message: 'from must be <= to' });

export type BookingResponse = {
  id: string;
  source: string;
  externalId: string | null;
  propertyId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  numAdults: number;
  numChildren: number;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  createdAt: string;
};

type EventRow = {
  id: string; propertyId: string; channelId: string | null; source: string | null;
  title: string | null; startDate: string; endDate: string; type: string;
  originalUid: string | null; tags: string[];
  guestEmail: string | null; guestPhone: string | null;
  numAdults: number | null; numChildren: number | null;
  createdAt: Date;
};

type BookingRow = {
  id: string; propertyId: string; name: string | null;
  email: string | null; phone: string | null;
  guests: number; checkIn: string; checkOut: string;
  status: string; source: string; createdAt: Date;
};

export function serializeEventAsBooking(e: EventRow): BookingResponse {
  const isInquiry = e.tags?.includes('inquiry') || (e.title || '').startsWith('[문의]');
  let status: BookingStatus = 'confirmed';
  if (e.type === 'block') status = 'cancelled';
  else if (isInquiry) status = 'inquiry';
  return {
    id: e.id,
    source: e.source || e.channelId || 'unknown',
    externalId: e.originalUid,
    propertyId: e.propertyId,
    guestName: (e.title || '').replace(/^\[문의\]\s*/, '').trim() || 'Guest',
    guestEmail: e.guestEmail,
    guestPhone: e.guestPhone,
    numAdults: e.numAdults ?? 0,
    numChildren: e.numChildren ?? 0,
    checkIn: e.startDate,
    checkOut: e.endDate,
    status,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeBookingRow(b: BookingRow): BookingResponse {
  return {
    id: b.id,
    source: b.source || 'direct',
    externalId: null,
    propertyId: b.propertyId,
    guestName: b.name || 'Guest',
    guestEmail: b.email,
    guestPhone: b.phone,
    numAdults: b.guests,    // direct booking 은 인원수 합계만 — adult 로 매핑, child 0
    numChildren: 0,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    status: (b.status as BookingStatus) || 'confirmed',
    createdAt: b.createdAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Cleanings
// ─────────────────────────────────────────────────────────────────────────

export const cleaningStatusSchema = z.enum(['pending', 'done']);
export type CleaningStatus = z.infer<typeof cleaningStatusSchema>;

export const cleaningsQuerySchema = z
  .object({
    propertyId: z.string().uuid().optional(),
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
    status: cleaningStatusSchema.optional(),
    externalSource: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional().default(200),
  })
  .refine(dateRangeRefine, { message: 'from must be <= to' });

export const cleaningCreateSchema = z.object({
  propertyId: z.string().uuid(),
  date: dateStringSchema,
  // 자체 cleaner pool (스테이폴리오) 사용 시
  externalCleanerName: z.string().min(1).max(100).optional().nullable(),
  externalCleanerPhone: z.string().max(40).optional().nullable(),
  // 우리 공유 cleaner pool 사용 시 (cleaner.id 명시)
  cleanerId: z.string().uuid().optional().nullable(),
  // 멱등성: 같은 (externalSource, externalId) 면 update.
  // externalSource 는 ApiClient 인증에서 derive 가능하지만 명시도 허용 — 단 1개만.
  externalId: z.string().min(1).max(200),
  status: cleaningStatusSchema.optional().default('pending'),
  supplies: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CleaningCreateInput = z.infer<typeof cleaningCreateSchema>;

export const cleaningPatchSchema = z.object({
  externalCleanerName: z.string().min(1).max(100).optional().nullable(),
  externalCleanerPhone: z.string().max(40).optional().nullable(),
  cleanerId: z.string().uuid().optional().nullable(),
  status: cleaningStatusSchema.optional(),
  supplies: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  completionNote: z.string().max(2000).optional().nullable(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'at least one field is required' },
);
export type CleaningPatchInput = z.infer<typeof cleaningPatchSchema>;

export type CleaningResponse = {
  id: string;
  propertyId: string;
  date: string;
  status: CleaningStatus;
  cleanerSource: 'internal' | 'external' | null;
  cleanerName: string | null;
  cleanerPhone: string | null;
  externalSource: string | null;
  externalId: string | null;
  supplies: string | null;
  notes: string | null;
  completionNote: string | null;
  completedAt: string | null;
  hasIssue: boolean;
  createdAt: string;
};

type CleaningRow = {
  id: string; propertyId: string; date: string;
  cleanerId: string | null; status: string;
  supplies: string | null; notes: string | null;
  completionNote: string | null; completedAt: Date | null;
  hasIssue: boolean; createdAt: Date;
  externalSource: string | null; externalId: string | null;
  externalCleanerName: string | null; externalCleanerPhone: string | null;
  cleaner?: { name: string; phone: string | null } | null;
};

export function serializeCleaning(c: CleaningRow): CleaningResponse {
  let cleanerName: string | null = null;
  let cleanerPhone: string | null = null;
  let cleanerSource: 'internal' | 'external' | null = null;
  if (c.cleaner) {
    cleanerName = c.cleaner.name;
    cleanerPhone = c.cleaner.phone;
    cleanerSource = 'internal';
  } else if (c.externalCleanerName) {
    cleanerName = c.externalCleanerName;
    cleanerPhone = c.externalCleanerPhone;
    cleanerSource = 'external';
  }
  return {
    id: c.id,
    propertyId: c.propertyId,
    date: c.date,
    status: (c.status as CleaningStatus) || 'pending',
    cleanerSource,
    cleanerName,
    cleanerPhone,
    externalSource: c.externalSource,
    externalId: c.externalId,
    supplies: c.supplies,
    notes: c.notes,
    completionNote: c.completionNote,
    completedAt: c.completedAt?.toISOString() ?? null,
    hasIssue: c.hasIssue,
    createdAt: c.createdAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Availability
// ─────────────────────────────────────────────────────────────────────────

export const availabilityQuerySchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
  })
  .refine(dateRangeRefine, { message: 'from must be <= to' });

export type AvailabilityDay = {
  date: string;
  available: boolean;
  bookingId: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Validation helper — Zod issues → API error response format
// ─────────────────────────────────────────────────────────────────────────

export function zodIssuesToDetails(err: z.ZodError) {
  return err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
}
