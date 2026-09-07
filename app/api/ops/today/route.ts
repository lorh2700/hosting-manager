import { prisma } from '@/lib/prisma';
import { withAuth, ok, visibleScope } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';
import { checkoutStatusByProperty, type CheckoutStatus } from '@/lib/checkout';
import { CAMERA_BUCKET } from '@/lib/camera-types';
import { createSignedUrl } from '@/lib/supabaseStorage';
import { detectGuestFlags, nightsBetween, type GuestFlag } from '@/lib/ops-flags';
import { getChannelLabel } from '@/app/admin/calendar/types';

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
  channel: string;
  hasChat: boolean;
  unread: number;
  flags: GuestFlag[];
  messages: OpsMessage[];
}
export interface OpsProperty {
  id: string;
  name: string;
  hasWork: boolean;
  cleaning: { id: string; status: string; cleanerId: string | null; cleanerName: string | null; supplies: string | null; notes: string | null } | null;
  checkoutStatus: CheckoutStatus | null;
  checkouts: OpsReservation[];
  checkins: OpsReservation[];
  camera: { id: string; capturedAt: string; url: string | null; leaving: boolean; summary: string | null }[];
}

const MESSAGES_PER_GUEST = 4;

export const GET = withAuth('ops/today', async (_req, { auth }) => {
  const today = todayKst();
  const visible = await visibleScope(auth);
  const properties = await prisma.property.findMany({
    where: visible === null ? {} : { id: { in: visible } },
    select: { id: true, name: true, ownerId: true },
    orderBy: { name: 'asc' },
  });
  const propIds = properties.map(p => p.id);
  if (propIds.length === 0) {
    return ok({ today, properties: [], cleaners: [], counts: { pendingApplications: 0, openIssues: 0, pendingSupplies: 0 } });
  }

  const [events, bookings, cleanings, checkoutStatus, cameraRows, cleaners, pendingApplications, openIssues, pendingSupplies] = await Promise.all([
    prisma.event.findMany({
      where: {
        propertyId: { in: propIds },
        type: 'reservation',
        NOT: { OR: [{ tags: { has: 'inquiry' } }, { title: { startsWith: '[문의]' } }] },
        OR: [{ startDate: today }, { endDate: today }],
      },
      select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, source: true, channelId: true, numAdults: true, numChildren: true },
    }),
    prisma.booking.findMany({
      where: { propertyId: { in: propIds }, status: 'confirmed', OR: [{ checkIn: today }, { checkOut: today }] },
      select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, guests: true, source: true },
    }),
    prisma.cleaning.findMany({
      where: { propertyId: { in: propIds }, date: today },
      include: { cleaner: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    checkoutStatusByProperty(propIds, today),
    prisma.cameraSnapshot.findMany({
      where: { propertyId: { in: propIds }, date: today },
      orderBy: { capturedAt: 'desc' },
      select: { id: true, propertyId: true, capturedAt: true, storagePath: true, leaving: true, verdict: true },
    }),
    auth.role === 'admin'
      ? prisma.cleaner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : prisma.cleaner.findMany({ where: { ownerId: auth.session.userId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.cleaningApplication.count({ where: { status: 'pending', propertyId: { in: propIds } } }),
    prisma.cleaningIssue.count({ where: { status: { in: ['open', 'in_progress'] }, propertyId: { in: propIds } } }),
    prisma.supplyTodo.count({ where: { done: false, propertyId: { in: propIds } } }),
  ]);

  // 최근 대화: 오늘 체크인·체크아웃 이벤트에 한해 마지막 4개 + 읽지 않은 게스트 메시지 수 + 자동 태그
  const eventIds = events.map(e => e.id);
  const messages = eventIds.length
    ? await prisma.message.findMany({
        where: { eventId: { in: eventIds }, type: 'message' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, eventId: true, sender: true, text: true, read: true, createdAt: true },
      })
    : [];
  const byEvent: Record<string, typeof messages> = {};
  for (const m of messages) if (m.eventId) (byEvent[m.eventId] ??= []).push(m);

  const eventView = (e: (typeof events)[number]): OpsReservation => {
    const list = byEvent[e.id] ?? [];
    const guestTexts = list.filter(m => m.sender === 'guest').map(m => m.text);
    const guests = (e.numAdults ?? 0) + (e.numChildren ?? 0);
    return {
      id: e.id,
      kind: 'event',
      propertyId: e.propertyId,
      guestName: (e.title || '').replace(/ 예약$/, '') || '게스트',
      start: e.startDate,
      end: e.endDate,
      nights: nightsBetween(e.startDate, e.endDate),
      guests: guests > 0 ? guests : null,
      channel: getChannelLabel(e.channelId ?? 'beds24', e.source ?? undefined, {}),
      hasChat: e.channelId === 'beds24',
      unread: list.filter(m => m.sender === 'guest' && !m.read).length,
      flags: detectGuestFlags(guestTexts),
      messages: list.slice(0, MESSAGES_PER_GUEST).reverse().map(m => ({ id: m.id, sender: m.sender, text: m.text, at: m.createdAt.toISOString() })),
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

  const cameraByProp: Record<string, typeof cameraRows> = {};
  for (const r of cameraRows) { const l = (cameraByProp[r.propertyId] ??= []); if (l.length < 3) l.push(r); }

  const out: OpsProperty[] = await Promise.all(properties.map(async p => {
    const cl = cleanings.find(c => c.propertyId === p.id && c.cleanerId) ?? cleanings.find(c => c.propertyId === p.id) ?? null;
    const checkouts = unique.filter(r => r.propertyId === p.id && r.end === today);
    const checkins = unique.filter(r => r.propertyId === p.id && r.start === today);
    const camera = await Promise.all((cameraByProp[p.id] ?? []).map(async r => ({
      id: r.id,
      capturedAt: r.capturedAt.toISOString(),
      url: await createSignedUrl({ bucket: CAMERA_BUCKET, path: r.storagePath }),
      leaving: r.leaving,
      summary: (r.verdict as { summary?: string } | null)?.summary ?? null,
    })));
    return {
      id: p.id,
      name: p.name,
      hasWork: !!cl || checkouts.length > 0 || checkins.length > 0,
      cleaning: cl ? { id: cl.id, status: cl.status, cleanerId: cl.cleanerId, cleanerName: cl.cleaner?.name ?? null, supplies: cl.supplies, notes: cl.notes } : null,
      checkoutStatus: checkoutStatus[p.id] ?? null,
      checkouts,
      checkins,
      camera,
    };
  }));

  out.sort((a, b) => Number(b.hasWork) - Number(a.hasWork) || a.name.localeCompare(b.name));
  return ok({ today, properties: out, cleaners, counts: { pendingApplications, openIssues, pendingSupplies } });
});
