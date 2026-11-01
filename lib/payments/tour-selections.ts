import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CheckoutOrder, Prisma } from '@/generated/prisma/client';
import { fail } from '@/lib/core/errors';
import { todayKst } from '@/lib/dates';
import { propertyAllowsModule } from '@/lib/operational-access';
import type { StayTour, StayTourSelectionSnapshot } from '@/lib/stay-tour-types';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const idSchema = z.string().trim().min(1).max(128);
const languageSchema = z.enum(['ko', 'en', 'zh', 'ja']);
const moneySchema = z.number().int().min(0).max(100_000_000);
export const tourSelectionInputSchema = z.object({
  tourId: idSchema,
  requestedDate: dateSchema,
  requestedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  guests: z.number().int().min(1).max(50),
  durationOptionId: idSchema.optional(),
  tickets: z.array(z.object({ tierId: idSchema, count: z.number().int().min(1).max(50) }).strict()).max(20).optional(),
  language: languageSchema.default('ko'),
}).strict();
export const tourSelectionsInputSchema = z.array(tourSelectionInputSchema).max(3).refine(
  items => new Set(items.map(item => item.tourId)).size === items.length,
).default([]);

const snapshotSchema = z.object({
  tourId: idSchema, title: z.string(), slug: z.string(),
  requestedDate: dateSchema, requestedTime: z.string(), guests: z.number().int().positive(),
  durationOptionId: z.string().nullable(), durationLabel: z.string().nullable(),
  durationMin: z.number().int().nonnegative().nullable(),
  unitPrice: moneySchema.nullable(), totalPrice: moneySchema.nullable(),
  tickets: z.array(z.object({ tierId: idSchema, label: z.string(), count: z.number().int().positive(), unitPrice: moneySchema })),
  language: languageSchema, requestStatus: z.enum(['selected', 'submitted', 'unavailable']), inquiryId: z.string().nullable(),
});
const storedSchema = z.object({ version: z.literal(1), selections: z.array(snapshotSchema).max(3) });

export function readTourSelections(value: unknown): StayTourSelectionSnapshot[] {
  if (value == null) return [];
  return storedSchema.parse(value).selections;
}

export function storeTourSelections(selections: StayTourSelectionSnapshot[]) {
  return storedSchema.parse({ version: 1, selections });
}

const propertySelect = { id: true, name: true, status: true, maxGuests: true, ownerId: true, organizationId: true, featureOverrides: true,
  organization: { select: { status: true, features: true } } } satisfies Prisma.PropertySelect;
type TourProperty = Prisma.PropertyGetPayload<{ select: typeof propertySelect }>;

async function loadTourProperty(propertyId: string, db: Pick<Prisma.TransactionClient, 'property'> = prisma) {
  const property = await db.property.findUnique({ where: { id: propertyId }, select: propertySelect });
  if (!property || property.status !== 'active' || !propertyAllowsModule(property, 'reservations')) throw fail(404, '숙소를 찾을 수 없습니다.');
  return property;
}

const tourSelect = { id: true, ownerId: true, organizationId: true, title: true, slug: true, description: true, meetingPoint: true,
  durationMin: true, basePrice: true, maxGroupSize: true, images: true, isActive: true,
  owner: { select: { id: true, organizationId: true } },
  durationOptions: { orderBy: [{ sortOrder: 'asc' }, { durationMin: 'asc' }], select: { id: true, label: true, durationMin: true, price: true } },
  ticketTiers: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, label: true, price: true, notes: true } },
} satisfies Prisma.TourSelect;
type TourProduct = Prisma.TourGetPayload<{ select: typeof tourSelect }>;

function belongsToProperty(tour: Pick<TourProduct, 'ownerId' | 'owner' | 'organizationId'>, property: TourProperty) {
  if (tour.organizationId) return tour.organizationId === property.organizationId;
  return property.organizationId
    ? tour.owner?.organizationId === property.organizationId
    : tour.ownerId === property.ownerId && !tour.owner?.organizationId;
}

function publicTour(tour: TourProduct): StayTour {
  return { id: tour.id, title: tour.title, slug: tour.slug, description: tour.description,
    meetingPoint: tour.meetingPoint, durationMin: tour.durationMin,
    basePrice: tour.basePrice === null ? null : Number(tour.basePrice), maxGroupSize: tour.maxGroupSize, images: tour.images,
    durationOptions: tour.durationOptions.map(option => ({ ...option, price: Number(option.price) })),
    ticketTiers: tour.ticketTiers.map(tier => ({ ...tier, price: Number(tier.price) })),
  };
}

export async function listStayTours(propertyId: string): Promise<StayTour[]> {
  const property = await loadTourProperty(propertyId);
  if (!propertyAllowsModule(property, 'tours')) return [];
  const tours = await prisma.tour.findMany({ where: { isActive: true,
    ...(property.organizationId ? { OR: [{ organizationId: property.organizationId },
      { organizationId: null, owner: { organizationId: property.organizationId } }] }
      : { organizationId: null, ownerId: property.ownerId, owner: { organizationId: null } }),
  }, select: tourSelect, orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 100 });
  return tours.filter(tour => belongsToProperty(tour, property)).map(publicTour);
}

type StaySelectionContext = { propertyId: string; checkIn: string; checkOut: string; guests: number };

export async function resolveTourSelections(raw: unknown, stay: StaySelectionContext,
  db: Pick<Prisma.TransactionClient, 'property' | 'tour'> = prisma): Promise<StayTourSelectionSnapshot[]> {
  const parsed = tourSelectionsInputSchema.safeParse(raw);
  if (!parsed.success) throw fail(400, '투어 선택 정보를 확인해주세요.');
  if (!parsed.data.length) return [];
  const property = await loadTourProperty(stay.propertyId, db);
  if (!propertyAllowsModule(property, 'tours')) throw fail(403, '현재 이 숙소에서 투어를 신청할 수 없습니다.');
  const tours = await db.tour.findMany({ where: { id: { in: parsed.data.map(item => item.tourId) }, isActive: true }, select: tourSelect });
  return parsed.data.map(item => {
    const tour = tours.find(candidate => candidate.id === item.tourId && belongsToProperty(candidate, property));
    if (!tour) throw fail(400, '이 숙소에서 신청할 수 없는 투어입니다.');
    const requestedAt = new Date(`${item.requestedDate}T${item.requestedTime}:00+09:00`);
    if (item.requestedDate < stay.checkIn || item.requestedDate > stay.checkOut ||
        todayKst(requestedAt) !== item.requestedDate || requestedAt.getTime() <= Date.now()) {
      throw fail(400, '투어 희망 일정은 투숙 예정일 안의 미래 시간으로 선택해주세요.');
    }
    if (item.guests > stay.guests || item.guests > (tour.maxGroupSize ?? 50)) throw fail(400, '투어 인원은 투숙 인원과 투어 최대 인원을 초과할 수 없습니다.');
    const option = tour.durationOptions.find(candidate => candidate.id === item.durationOptionId);
    if ((item.durationOptionId && !option) || (tour.durationOptions.length && !option)) throw fail(400, '투어 코스를 다시 선택해주세요.');
    const tickets: StayTourSelectionSnapshot['tickets'] = [];
    if (tour.ticketTiers.length) {
      if (!item.tickets?.length || new Set(item.tickets.map(ticket => ticket.tierId)).size !== item.tickets.length) throw fail(400, '투어 티켓을 확인해주세요.');
      for (const ticket of item.tickets) {
        const tier = tour.ticketTiers.find(candidate => candidate.id === ticket.tierId);
        if (!tier) throw fail(400, '이 투어의 티켓 종류를 선택해주세요.');
        tickets.push({ tierId: tier.id, label: tier.label, count: ticket.count, unitPrice: Number(tier.price) });
      }
      if (tickets.reduce((sum, ticket) => sum + ticket.count, 0) !== item.guests) throw fail(400, '티켓 인원과 투어 참여 인원을 맞춰주세요.');
    } else if (item.tickets?.length) throw fail(400, '이 투어는 티켓 구분을 사용하지 않습니다.');
    const unitPrice = tickets.length ? null : option ? Number(option.price) : tour.basePrice === null ? null : Number(tour.basePrice);
    const totalPrice = tickets.length ? tickets.reduce((sum, ticket) => sum + ticket.unitPrice * ticket.count, 0)
      : unitPrice === null ? null : unitPrice * item.guests;
    const snapshot = snapshotSchema.safeParse({ ...item, title: tour.title, slug: tour.slug,
      durationOptionId: option?.id ?? null, durationLabel: option?.label ?? null, durationMin: option?.durationMin ?? tour.durationMin,
      unitPrice, totalPrice, tickets, requestStatus: 'selected', inquiryId: null });
    if (!snapshot.success) throw fail(400, '투어 가격 설정을 확인 중입니다. 다른 투어를 선택해주세요.');
    return snapshot.data;
  });
}

export function stayTourInquiryId(orderId: string, tourId: string) {
  const hex = createHash('sha256').update(`stay-tour:${orderId}:${tourId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function selectionNote(item: StayTourSelectionSnapshot) {
  const language = { ko: '한국어', en: 'English', zh: '中文', ja: '日本語' }[item.language];
  return [item.durationLabel ? `선택 코스: ${item.durationLabel}` : null,
    `희망 언어: ${language}`, item.tickets.length ? `티켓: ${item.tickets.map(ticket => `${ticket.label} ${ticket.count}명`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

export async function submitConfirmedStayTours(tx: Prisma.TransactionClient, order: CheckoutOrder, bookingId: string) {
  const selections = readTourSelections(order.tourSelections);
  if (!selections.length) return null;
  const property = await tx.property.findUnique({ where: { id: order.propertyId }, select: propertySelect });
  const tours = await tx.tour.findMany({ where: { id: { in: selections.map(item => item.tourId) } }, select: tourSelect });
  const submitted: StayTourSelectionSnapshot[] = [];
  for (const item of selections) {
    const tour = tours.find(candidate => candidate.id === item.tourId);
    if (!property || !propertyAllowsModule(property, 'tours') || !tour?.isActive || !belongsToProperty(tour, property)
        || new Date(`${item.requestedDate}T${item.requestedTime}:00+09:00`).getTime() <= Date.now()) {
      submitted.push({ ...item, requestStatus: 'unavailable', inquiryId: null });
      continue;
    }
    const id = stayTourInquiryId(order.id, item.tourId);
    await tx.tourBooking.upsert({ where: { id }, update: {}, create: {
      id, tourId: tour.id, bookingId, requestedDate: item.requestedDate, requestedTime: item.requestedTime,
      durationOptionId: tour.durationOptions.some(option => option.id === item.durationOptionId) ? item.durationOptionId : null,
      durationMin: item.durationMin, unitPrice: item.unitPrice, totalPrice: item.totalPrice, tickets: item.tickets,
      language: item.language, meetingChoice: 'accommodation', meetingDetail: order.propertyName,
      name: order.name, email: order.email, phone: order.phone, guests: item.guests, status: 'pending', source: 'stay_checkout',
      message: `숙박 예약번호: ${bookingId}\n숙소: ${order.propertyName}\n투숙일: ${order.checkIn} ~ ${order.checkOut}\n${selectionNote(item)}\n투어는 일정 확인 후 별도 확정·결제합니다. 숙박 결제금액에 포함되지 않았습니다.`,
    } });
    submitted.push({ ...item, requestStatus: 'submitted', inquiryId: id });
  }
  return storeTourSelections(submitted);
}

const standaloneInputSchema = z.object({
  propertyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), checkIn: dateSchema, checkOut: dateSchema,
  guests: z.number().int().min(1).max(20), name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(/^[+\d][\d\s()-]{6,24}$/),
  email: z.union([z.email().max(100), z.literal('')]).optional().transform(value => value?.toLowerCase() || null),
  tourSelections: tourSelectionsInputSchema.refine(items => items.length > 0),
  idempotencyKey: z.uuid().transform(value => value.toLowerCase()),
}).strict();

const inquirySelect = { id: true, tourId: true, status: true, requestedDate: true, requestedTime: true,
  totalPrice: true, requestHash: true } satisfies Prisma.TourBookingSelect;
type SavedInquiry = Prisma.TourBookingGetPayload<{ select: typeof inquirySelect }>;

function inquiryResult(rows: SavedInquiry[], replayed: boolean) {
  return { success: true as const, lodgingBooked: false as const, replayed,
    inquiries: rows.map(row => ({ id: row.id, tourId: row.tourId, status: row.status,
      requestedDate: row.requestedDate, requestedTime: row.requestedTime,
      totalPrice: row.totalPrice === null ? null : Number(row.totalPrice) })) };
}

export async function submitStayTourInquiry(raw: unknown) {
  const parsed = standaloneInputSchema.safeParse(raw);
  if (!parsed.success) throw fail(400, '숙소·투숙 예정일·투어·연락처를 확인해주세요.');
  const input = parsed.data;
  const { idempotencyKey, ...payload } = input;
  const requestHash = createHash('sha256').update(JSON.stringify({ ...payload,
    tourSelections: [...payload.tourSelections].sort((a, b) => a.tourId.localeCompare(b.tourId)).map(item => ({ ...item,
      tickets: item.tickets ? [...item.tickets].sort((a, b) => a.tierId.localeCompare(b.tierId)) : undefined,
    })),
  })).digest('hex');

  return prisma.$transaction(async tx => {
    // One request can contain different tours, so the whole request key must be serialized.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`stay-tour-inquiry:${idempotencyKey}`}, 0))`;
    const previous = await tx.tourBooking.findMany({ where: { requestKey: idempotencyKey }, select: inquirySelect, orderBy: { tourId: 'asc' } });
    if (previous.length) {
      if (previous.length !== input.tourSelections.length || previous.some(row => row.requestHash !== requestHash)) {
        throw fail(409, '이미 접수한 요청과 내용이 다릅니다. 변경한 내용으로 새 문의를 접수해주세요.', { code: 'IDEMPOTENCY_CONFLICT' });
      }
      return inquiryResult(previous, true);
    }
    const nights = (Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86400000;
    if (input.checkIn < todayKst() || nights < 1 || nights > 30) throw fail(400, '투숙 예정일은 미래 일정으로 1~30박을 선택해주세요.');
    const property = await loadTourProperty(input.propertyId, tx);
    if (property.maxGuests && input.guests > property.maxGuests) throw fail(400, '투숙 인원은 숙소 최대 인원을 초과할 수 없습니다.');
    const selections = await resolveTourSelections(input.tourSelections, input, tx);
    const rows: SavedInquiry[] = [];
    for (const item of selections) {
      rows.push(await tx.tourBooking.create({ select: inquirySelect, data: {
        tourId: item.tourId, requestedDate: item.requestedDate, requestedTime: item.requestedTime,
        durationOptionId: item.durationOptionId, durationMin: item.durationMin, unitPrice: item.unitPrice,
        totalPrice: item.totalPrice, tickets: item.tickets, language: item.language, guests: item.guests,
        name: input.name, phone: input.phone, email: input.email,
        meetingChoice: 'accommodation', meetingDetail: property.name,
        status: 'pending', source: 'stay_inquiry', requestKey: idempotencyKey, requestHash,
        message: `투숙 예정 숙소: ${property.name}\n투숙 예정일: ${input.checkIn} ~ ${input.checkOut}\n${selectionNote(item)}\n숙박 예약과 별도로 접수한 투어 문의입니다. 숙박은 확정되지 않았으며, 투어도 일정 확인 후 별도 확정·결제합니다.`,
      } }));
    }
    return inquiryResult(rows, false);
  });
}
