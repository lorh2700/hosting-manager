import { createOpsReadQueue, mapOpsReads } from '@/lib/ops-loading';
import { listAssignees } from '@/lib/staff-directory';
import { readStayOptions } from '@/lib/payments/stay-options';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, visibleScope } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';
import { checkoutStatusByProperty, type CheckoutStatus } from '@/lib/checkout';
import { CAMERA_BUCKET } from '@/lib/camera-types';
import { createSignedUrl } from '@/lib/supabaseStorage';
import { detectGuestFlags, nightsBetween, type GuestFlag } from '@/lib/ops-flags';
import { getRoomReadyMessage, type Property as CalendarProperty, getChannelLabel } from '@/app/admin/calendar/types';

/**
 * 오늘 정비·입실·퇴실과 안내 발송 상태를 반환한다. board는 최근 대화와
 * 배정 후보를 생략하고, conversation/assignees/cameras는 필요할 때 읽는다.
 * 기존 details/summary 응답은 계속 지원한다.
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
  /** False while recent conversation/flags are deliberately deferred. */
  messagesLoaded?: boolean;
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
  const search = new URL(req.url).searchParams;
  const view = search.get('view');
  const summaryOnly = view === 'summary';
  const boardOnly = view === 'board';
  const includeCounts = !boardOnly && search.get('includeCounts') !== 'false';
  const unavailable: string[] = [];
  const timings: string[] = [];
  const read = createOpsReadQueue(3);
  function respond(body: unknown) {
    const response = ok(body);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Server-Timing', [...timings, `ops;dur=${(performance.now() - started).toFixed(1)}`].join(', '));
    return response;
  }
  async function timed<T>(name: string, read: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await read(); }
    finally { timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`); }
  }
  async function optional<T>(section: string, read: () => Promise<T>, fallback: T): Promise<T> {
    if (summaryOnly) return fallback;
    const start = performance.now();
    try { return await timed(section, read); }
    catch (error) {
      unavailable.push(section);
      console.error('[ops/today]', { section, durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.name : 'UnknownError' });
      return fallback;
    }
  }
  const today = todayKst();
  const visible = await timed('scope', () => visibleScope(auth));
  if (view === 'assignees') {
    const cleaners = await timed('cleaners', () => listAssignees(auth, visible));
    return respond({ today, cleaners, cleanersLoaded: true });
  }
  if (view === 'conversation') {
    const eventId = search.get('eventId')?.trim();
    if (!eventId) throw fail(400, 'eventId은(는) 필수입니다.');
    // A lazy conversation must have the same property and today constraints as
    // the board. Do not allow an arbitrary reservation ID to bypass that scope.
    const event = await timed('reservation', () => prisma.event.findFirst({
      where: { id: eventId, ...(visible === null ? {} : { propertyId: { in: visible } }),
        type: 'reservation', channelId: 'beds24',
        NOT: { OR: [{ tags: { has: 'inquiry' } }, { title: { startsWith: '[문의]' } }] },
        OR: [{ startDate: today }, { endDate: today }],
      }, select: { id: true },
    }));
    if (!event) throw fail(404, '오늘 확인할 예약을 찾을 수 없습니다.');
    const recent = await timed('messages', () => prisma.message.findMany({
      where: { eventId: event.id, type: 'message' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MESSAGES_PER_GUEST,
      select: { id: true, sender: true, text: true, createdAt: true },
    }));
    return respond({ today, eventId: event.id, messagesAvailable: true, messagesLoaded: true,
      flags: detectGuestFlags(recent.filter(m => m.sender === 'guest').map(m => m.text)),
      messages: recent.reverse().map(m => ({ id: m.id, sender: m.sender, text: m.text, at: m.createdAt.toISOString() })),
    });
  }
  const properties = await timed('properties', () => prisma.property.findMany({
    where: visible === null ? {} : { id: { in: visible } },
    select: { id: true, name: true, roomReadyMessage: true, doorPassword: true, addressUrl: true },
    orderBy: { name: 'asc' },
  }));
  const propIds = properties.map(p => p.id);
  if (propIds.length === 0) {
    return respond({ today, unavailable: [], detailsLoaded: !summaryOnly, cleanersLoaded: !summaryOnly && !boardOnly,
      properties: [], cleaners: [], counts: { pendingApplications: 0, openIssues: 0, pendingSupplies: 0 } });
  }

  // Optional media must never delay the operational summary. Each property is
  // bounded independently so a busy camera cannot crowd out other properties.
  if (view === 'cameras') {
    const photoGroups = await timed('camera_index', () => prisma.cameraSnapshot.groupBy({
      by: ['propertyId'], where: { propertyId: { in: propIds }, date: today }, _count: { _all: true },
    }));
    const withPhotos = new Set(photoGroups.map(group => group.propertyId));
    const previews = await timed('camera_previews', () => mapOpsReads(propIds, async propertyId => {
      if (!withPhotos.has(propertyId)) return { id: propertyId, camera: [] };
      const rows = await prisma.cameraSnapshot.findMany({ where: { propertyId, date: today },
        orderBy: { capturedAt: 'desc' }, take: 3,
        select: { id: true, capturedAt: true, storagePath: true, leaving: true, verdict: true } });
      const camera = await Promise.all(rows.map(async r => ({ id: r.id, capturedAt: r.capturedAt.toISOString(),
        url: await createSignedUrl({ bucket: CAMERA_BUCKET, path: r.storagePath }), leaving: r.leaving,
        summary: (r.verdict as { summary?: string } | null)?.summary ?? null })));
      return { id: propertyId, camera };
    }));
    return respond({ today, properties: previews });
  }

  // Reservations, cleaning and checkout signals are independent once the
  // property scope is known. Share the pool's three slots across all sections.
  const reservations = timed('reservations', () => Promise.all([
    read(() => prisma.event.findMany({
      where: {
        propertyId: { in: propIds },
        type: 'reservation',
        NOT: { OR: [{ tags: { has: 'inquiry' } }, { title: { startsWith: '[문의]' } }] },
        OR: [{ startDate: today }, { endDate: today }],
      },
      select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, source: true, channelId: true, numAdults: true, numChildren: true, originalUid: true },
    })),
    read(() => prisma.booking.findMany({
      where: { propertyId: { in: propIds }, status: 'confirmed', OR: [{ checkIn: today }, { checkOut: today }] },
      select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, guests: true, source: true, channelBookingRef: true, checkout: { select: { stayOptions: true, beds24Id: true } } },
    })),
  ]));
  const cleaningRead = optional('cleaning', () => read(() => prisma.cleaning.findMany({
    where: { propertyId: { in: propIds }, date: today },
    select: { id: true, propertyId: true, status: true, cleanerId: true, supplies: true, notes: true, cleaner: { select: { displayName: true } } },
    orderBy: { createdAt: 'desc' },
  })), []);
  const checkoutRead = optional('checkout', () => read(() => checkoutStatusByProperty(propIds, today)), {});
  const cleanersRead = boardOnly ? Promise.resolve([]) : optional('cleaners', () => read(() => listAssignees(auth, visible)), []);
  const [events, bookings] = await reservations;

  const conversationRead = optional('messages', async () => {
    const result: Record<string, { messages: OpsMessage[]; unread: number; readyDelivery: string | null; flags: GuestFlag[] }> = {};
    if (!events.length) return result;
    const eventIds = events.map(event => event.id);
    const [unreadRows, readyRows] = await Promise.all([
      read(() => prisma.message.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, type: 'message', sender: 'guest', read: false }, _count: { _all: true } })),
      read(() => prisma.message.findMany({
        where: { type: 'message', sender: 'host', OR: events.map(event => ({ eventId: event.id, text: getRoomReadyMessage(properties as unknown as CalendarProperty[], event.propertyId) })) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], distinct: ['eventId'],
        select: { eventId: true, deliveryStatus: true },
      })),
    ]);
    const unreadByEvent = new Map(unreadRows.map(row => [row.eventId, row._count._all]));
    const readyByEvent = new Map(readyRows.map(row => [row.eventId, row.deliveryStatus]));
    if (boardOnly) {
      for (const event of events) result[event.id] = { unread: unreadByEvent.get(event.id) ?? 0,
        readyDelivery: readyByEvent.get(event.id) ?? null, flags: [], messages: [] };
      return result;
    }
    // Bound each reservation independently; never apply one global take to all guests.
    await mapOpsReads(events, async event => {
      const where = { eventId: event.id, type: 'message' };
      const recent = await read(() => prisma.message.findMany({ where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MESSAGES_PER_GUEST,
        select: { id: true, sender: true, text: true, createdAt: true },
      }));
      result[event.id] = { unread: unreadByEvent.get(event.id) ?? 0, readyDelivery: readyByEvent.get(event.id) ?? null,
        flags: detectGuestFlags(recent.filter(m => m.sender === 'guest').map(m => m.text)),
        messages: recent.reverse().map(m => ({ id: m.id, sender: m.sender, text: m.text, at: m.createdAt.toISOString() })),
      };
    });
    return result;
  }, {});
  const countsRead = Promise.all([
    !includeCounts ? null : optional<number | null>('applications', () => read(() => prisma.cleaningApplication.count({ where: { status: 'pending', propertyId: { in: propIds } } })), null),
    !includeCounts ? null : optional<number | null>('issues', () => read(() => prisma.cleaningIssue.count({ where: { status: { in: ['open', 'in_progress'] }, propertyId: { in: propIds } } })), null),
    !includeCounts ? null : optional<number | null>('supplies', () => read(() => prisma.supplyTodo.count({ where: { done: false, propertyId: { in: propIds } } })), null),
  ]);
  const [cleanings, checkoutStatus, cleaners, conversations, counts] = await Promise.all([
    cleaningRead, checkoutRead, cleanersRead, conversationRead, countsRead,
  ]);
  const [pendingApplications, openIssues, pendingSupplies] = counts;

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
      channel: (() => {
        const label = getChannelLabel(e.channelId ?? 'beds24', e.source ?? undefined, {});
        // The generic calendar label falls back to direct for unrecognised OTAs.
        // Keep the real source visible in today's reservation and send context.
        return e.channelId === 'beds24' && label === '직접예약' && e.source?.trim().toLowerCase() !== 'direct'
          ? e.source?.trim() || 'Beds24 · 플랫폼 확인 필요'
          : label;
      })(),
      hasChat: e.channelId === 'beds24',
      unread: conversation?.unread ?? 0,
      flags: conversation?.flags ?? [],
      messages: conversation?.messages ?? [],
      messagesAvailable: !boardOnly && !!conversation,
      messagesLoaded: !boardOnly && !!conversation,
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
  return respond({ today, unavailable, detailsLoaded: !summaryOnly,
    cleanersLoaded: !summaryOnly && !boardOnly && !unavailable.includes('cleaners'),
    properties: out, cleaners, counts: { pendingApplications, openIssues, pendingSupplies } });
}, { serverTiming: true });
