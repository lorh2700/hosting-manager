import { listAssignees } from '@/lib/staff-directory';
import { readStayOptions } from '@/lib/payments/stay-options';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, visibleScope } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';
import { checkoutStatusByProperty, type CheckoutStatus } from '@/lib/checkout';
import { CAMERA_BUCKET } from '@/lib/camera-types';
import { createSignedUrl } from '@/lib/supabaseStorage';
import { detectGuestFlags, nightsBetween, type GuestFlag } from '@/lib/ops-flags';
import { getRoomReadyMessage, type Property as CalendarProperty, getChannelLabel } from '@/app/admin/calendar/types';

/**
 * 정비 허브 전용 — 오늘 정비하는 지점, 체크인·체크아웃 게스트(투숙 일자·인원·채널), 그 게스트와의 최근 대화와
 * 자동 태그(얼리 체크인·레이트 체크아웃·요청사항), 체크아웃 확인 상태, 복도 카메라, 청소 배정을 한 번에 돌려준다.
 */
export interface OpsMessage { id: string; sender: string; text: string; at: string }
export interface OpsReservation {
  id: string;
  kind: 'event' | 'booking';
  propertyId: string;
  guestName: string;
  start: string;
  end: string;
  nights: number;
  guests: number | null;
  pets?: number | null;
  channel: string;
  hasChat: boolean;
  readyDelivery?: string | null;
  unread: number;
  flags: GuestFlag[];
  messages: OpsMessage[];
  messagesAvailable?: boolean;
}
export interface OpsProperty {
  id: string;
  name: string;
  readyMessage: string;
  hasWork: boolean;
  cleaning: { id: string; status: string; cleanerId: string | null; cleanerName: string | null; supplies: string | null; notes: string | null } | null;
  checkoutStatus: CheckoutStatus | null;
  checkouts: OpsReservation[];
  checkins: OpsReservation[];
  camera: { id: string; capturedAt: string; url: string | null; leaving: boolean; summary: string | null }[];
}

const MESSAGES_PER_GUEST = 4;

export const GET = withAuth('ops/today', async (req, { auth }) => {
  const started = performance.now();
  const view = new URL(req.url).searchParams.get('view');
  const summaryOnly = view === 'summary';
  const unavailable: string[] = [];
  async function optional<T>(section: string, read: () => Promise<T>, fallback: T): Promise<T> {
    if (summaryOnly) return fallback;
    const start = performance.now();
    try { return await read(); }
    catch (error) {
      unavailable.push(section);
      console.error('[ops/today]', { section, durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.name : 'UnknownError' });
      return fallback;
    }
  }
  const today = todayKst();
  const visible = await visibleScope(auth);
  const properties = await prisma.property.findMany({
    where: visible === null ? {} : { id: { in: visible } },
    select: { id: true, name: true, ownerId: true, roomReadyMessage: true, doorPassword: true, addressUrl: true },
    orderBy: { name: 'asc' },
  });
  const propIds = properties.map(p => p.id);
  if (propIds.length === 0) {
    return ok({ today, unavailable: [], detailsLoaded: !summaryOnly, properties: [], cleaners: [], counts: { pendingApplications: 0, openIssues: 0, pendingSupplies: 0 } });
  }

  // Optional media must never delay the operational summary. Each property is
  // bounded independently so a busy camera cannot crowd out other properties.
  if (view === 'cameras') {
    const previews = await Promise.all(propIds.map(async propertyId => {
      const rows = await prisma.cameraSnapshot.findMany({ where: { propertyId, date: today },
        orderBy: { capturedAt: 'desc' }, take: 3,
        select: { id: true, capturedAt: true, storagePath: true, leaving: true, verdict: true } });
      const camera = await Promise.all(rows.map(async r => ({ id: r.id, capturedAt: r.capturedAt.toISOString(),
        url: await createSignedUrl({ bucket: CAMERA_BUCKET, path: r.storagePath }), leaving: r.leaving,
        summary: (r.verdict as { summary?: string } | null)?.summary ?? null })));
      return { id: propertyId, camera };
    }));
    const response = ok({ today, properties: previews });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Server-Timing', `ops;dur=${(performance.now() - started).toFixed(1)}`);
    return response;
  }

  const [events, bookings] = await Promise.all([
    prisma.event.findMany({
      where: {
        propertyId: { in: propIds },
        type: 'reservation',
        NOT: { OR: [{ tags: { has: 'inquiry' } }, { title: { startsWith: '[문의]' } }] },
        OR: [{ startDate: today }, { endDate: today }],
      },
      select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, source: true, channelId: true, numAdults: true, numChildren: true, originalUid: true },
    }),
    prisma.booking.findMany({
      where: { propertyId: { in: propIds }, status: 'confirmed', OR: [{ checkIn: today }, { checkOut: today }] },
      select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, guests: true, source: true, channelBookingRef: true, checkout: { select: { stayOptions: true, beds24Id: true } } },
    }),
  ]);

  // Optional sections run after core reads and do not compete for all pool slots.
  const cleanings = await optional('cleaning', () => prisma.cleaning.findMany({
    where: { propertyId: { in: propIds }, date: today },
    include: { cleaner: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
  }), []);
  const checkoutStatus = await optional('checkout', () => checkoutStatusByProperty(propIds, today), {});
  const cleaners = await optional('cleaners', () => listAssignees(auth), []);
  const pendingApplications = await optional<number | null>('applications', () => prisma.cleaningApplication.count({ where: { status: 'pending', propertyId: { in: propIds } } }), null);
  const openIssues = await optional<number | null>('issues', () => prisma.cleaningIssue.count({ where: { status: { in: ['open', 'in_progress'] }, propertyId: { in: propIds } } }), null);
  const pendingSupplies = await optional<number | null>('supplies', () => prisma.supplyTodo.count({ where: { done: false, propertyId: { in: propIds } } }), null);

  const conversations = await optional('messages', async () => {
    const result: Record<string, { messages: OpsMessage[]; unread: number; readyDelivery: string | null; flags: GuestFlag[] }> = {};
    // Bound each reservation independently; never apply one global take to all guests.
    for (const event of events) {
      const where = { eventId: event.id, type: 'message' };
      const recent = await prisma.message.findMany({ where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MESSAGES_PER_GUEST,
        select: { id: true, sender: true, text: true, createdAt: true },
      });
      const unread = await prisma.message.count({ where: { ...where, sender: 'guest', read: false } });
      const ready = await prisma.message.findFirst({
        where: { ...where, sender: 'host', text: getRoomReadyMessage(properties as unknown as CalendarProperty[], event.propertyId) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { deliveryStatus: true },
      });
      result[event.id] = { unread, readyDelivery: ready?.deliveryStatus ?? null,
        flags: detectGuestFlags(recent.filter(m => m.sender === 'guest').map(m => m.text)),
        messages: recent.reverse().map(m => ({ id: m.id, sender: m.sender, text: m.text, at: m.createdAt.toISOString() })),
      };
    }
    return result;
  }, {});

  const eventView = (e: (typeof events)[number]): OpsReservation => {
    const linked = bookings.find(b => b.propertyId === e.propertyId && e.channelId === 'beds24' && e.originalUid && (b.channelBookingRef === e.originalUid || b.checkout?.beds24Id === e.originalUid));
    const conversation = conversations[e.id];
    const guests = (e.numAdults ?? 0) + (e.numChildren ?? 0);
    return {
      id: e.id,
      kind: 'event',
      readyDelivery: conversation?.readyDelivery ?? null,
      propertyId: e.propertyId,
      guestName: (e.title || '').replace(/ 예약$/, '') || '게스트',
      start: e.startDate,
      end: e.endDate,
      nights: nightsBetween(e.startDate, e.endDate),
      guests: guests > 0 ? guests : null,
      pets: readStayOptions(linked?.checkout?.stayOptions)?.pets ?? null,
      channel: getChannelLabel(e.channelId ?? 'beds24', e.source ?? undefined, {}),
      hasChat: e.channelId === 'beds24',
      unread: conversation?.unread ?? 0,
      flags: conversation?.flags ?? [],
      messages: conversation?.messages ?? [],
      messagesAvailable: !!conversation,
    };
  };
  const bookingView = (b: (typeof bookings)[number]): OpsReservation => ({
    id: b.id,
    kind: 'booking',
    propertyId: b.propertyId,
    guestName: b.name || '게스트',
    start: b.checkIn,
    end: b.checkOut,
    nights: nightsBetween(b.checkIn, b.checkOut),
    guests: b.guests ?? null,
    pets: readStayOptions(b.checkout?.stayOptions)?.pets ?? null,
    channel: getChannelLabel('direct', b.source ?? undefined, {}),
    hasChat: false,
    unread: 0,
    flags: [],
    messages: [],
  });

  const all = [...events.map(eventView), ...bookings.map(bookingView)];
  // 같은 숙소·같은 기간이 이벤트와 직접 예약 양쪽에 있으면 이벤트만
  const seen = new Set<string>();
  const unique = all.filter(r => { const k = `${r.propertyId}_${r.start}_${r.end}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const out: OpsProperty[] = await Promise.all(properties.map(async p => {
    const cl = cleanings.find(c => c.propertyId === p.id && c.cleanerId) ?? cleanings.find(c => c.propertyId === p.id) ?? null;
    const checkouts = unique.filter(r => r.propertyId === p.id && r.end === today);
    const checkins = unique.filter(r => r.propertyId === p.id && r.start === today);
    return {
      id: p.id,
      name: p.name,
      readyMessage: getRoomReadyMessage(properties as unknown as CalendarProperty[], p.id),
      hasWork: !!cl || checkouts.length > 0 || checkins.length > 0,
      cleaning: cl ? { id: cl.id, status: cl.status, cleanerId: cl.cleanerId, cleanerName: cl.cleaner?.displayName ?? null, supplies: cl.supplies, notes: cl.notes } : null,
      checkoutStatus: checkoutStatus[p.id] ?? null,
      checkouts,
      checkins,
      camera: [],
    };
  }));

  out.sort((a, b) => Number(b.hasWork) - Number(a.hasWork) || a.name.localeCompare(b.name));
  const response = ok({ today, unavailable, detailsLoaded: !summaryOnly, properties: out, cleaners, counts: { pendingApplications, openIssues, pendingSupplies } });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Server-Timing', `ops;dur=${(performance.now() - started).toFixed(1)}`);
  return response;
});
