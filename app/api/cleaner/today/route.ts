import { prisma } from '@/lib/prisma';
import { withAuth, ok, visibleScope } from '@/lib/core/http';
import { resolveCleaner } from '@/lib/access';
import { todayKst, addDaysToDateStr } from '@/lib/dates';
import { checkoutStatusByProperty } from '@/lib/checkout';

/**
 * 청소담당자 "오늘" 화면 전용 — 호출 한 번으로 화면에 필요한 것을 모두 돌려준다.
 * (이전에는 properties → cleanings/cleaners/bookings/events 6번 호출, 기간 제한 없음)
 *
 *  - checkins / checkouts: 오늘 체크인·체크아웃 예약 (이벤트 + 직접 예약, 중복 제거)
 *  - todayCleanings: 오늘 청소 전부 (담당자 이름 포함) — "오늘의 운영" 표
 *  - tasks: 내 청소 목록 (관리자는 전체). 지난 14일 ~ 앞으로 90일
 */
const PAST_DAYS = 14;
const FUTURE_DAYS = 90;

export interface TodayReservation {
  id: string; propertyId: string; propertyName: string; title: string; start: string; end: string;
  phone?: string; email?: string; guests?: number; source?: string | null; dataSource: 'event' | 'booking';
}
export interface TodayCleaningEntry {
  id: string; propertyId: string; propertyName: string; date: string;
  cleanerId: string | null; cleanerName: string | null; status: 'pending' | 'done'; isMine: boolean;
}
export interface TodayTask {
  cleaningId: string; propertyId: string; propertyName: string; date: string; guestName: string;
  supplies: string; status: 'pending' | 'done'; completionNote?: string; completedAt?: string; hasIssue?: boolean;
}

export const GET = withAuth('cleaner/today', async (_req, { auth }) => {
  const today = todayKst();
  const from = addDaysToDateStr(today, -PAST_DAYS);
  const to = addDaysToDateStr(today, FUTURE_DAYS);

  const [visible, me] = await Promise.all([visibleScope(auth), resolveCleaner(auth)]);
  const properties = await prisma.property.findMany({
    where: visible === null ? {} : { id: { in: visible } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const propIds = properties.map(p => p.id);
  const propName: Record<string, string> = Object.fromEntries(properties.map(p => [p.id, p.name]));
  const meOut = me ? { id: me.id, name: me.name, publicToken: me.publicToken } : null;

  if (propIds.length === 0) {
    return ok({ today, me: meOut, properties: [], checkins: [], checkouts: [], todayCleanings: [], tasks: [], checkoutToday: {} });
  }

  const [cleanings, events, bookings, checkoutToday] = await Promise.all([
    prisma.cleaning.findMany({
      where: { propertyId: { in: propIds }, date: { gte: from, lte: to } },
      include: { cleaner: { select: { id: true, name: true } } },
      orderBy: { date: 'asc' },
    }),
    prisma.event.findMany({
      where: {
        propertyId: { in: propIds },
        type: 'reservation',
        NOT: { OR: [{ tags: { has: 'inquiry' } }, { title: { startsWith: '[문의]' } }] },
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, source: true, channelId: true },
    }),
    prisma.booking.findMany({
      where: { propertyId: { in: propIds }, status: 'confirmed', checkIn: { lte: to }, checkOut: { gte: from } },
      select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, phone: true, email: true, guests: true, source: true },
    }),
    // 오늘 체크아웃 확인 상태 — "체크아웃 확인됨 11:05" 표시용
    checkoutStatusByProperty(propIds, today),
  ]);

  const reservations: TodayReservation[] = [
    ...events.map(e => ({
      id: e.id, propertyId: e.propertyId, propertyName: propName[e.propertyId] ?? '',
      title: (e.title || '').replace(/ 예약$/, ''), start: e.startDate, end: e.endDate,
      source: e.source || e.channelId || null, dataSource: 'event' as const,
    })),
    ...bookings.map(b => ({
      id: b.id, propertyId: b.propertyId, propertyName: propName[b.propertyId] ?? '',
      title: b.name || '', start: b.checkIn, end: b.checkOut,
      phone: b.phone || undefined, email: b.email || undefined, guests: b.guests || undefined,
      source: b.source || 'direct', dataSource: 'booking' as const,
    })),
  ];
  const seen = new Set<string>();
  const unique = reservations.filter(r => {
    const key = `${r.propertyId}_${r.start}_${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 청소 카드에 붙일 게스트 이름: 그 숙소에서 그 날 체크아웃하는 예약
  const guestByKey: Record<string, string> = {};
  for (const r of unique) if (r.title) guestByKey[`${r.propertyId}_${r.end}`] = r.title;

  const todayCleanings: TodayCleaningEntry[] = cleanings
    .filter(c => c.date === today)
    .map((c): TodayCleaningEntry => ({
      id: c.id, propertyId: c.propertyId, propertyName: propName[c.propertyId] ?? '',
      date: c.date, cleanerId: c.cleanerId, cleanerName: c.cleaner?.name ?? null,
      status: c.status === 'done' ? 'done' : 'pending',
      isMine: !!me && c.cleanerId === me.id,
    }))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

  const mine = auth.role === 'admin' ? cleanings : me ? cleanings.filter(c => c.cleanerId === me.id) : [];
  const tasks: TodayTask[] = mine.map(c => ({
    cleaningId: c.id, propertyId: c.propertyId, propertyName: propName[c.propertyId] ?? '',
    date: c.date, guestName: guestByKey[`${c.propertyId}_${c.date}`] ?? '',
    supplies: c.supplies ?? '', status: c.status === 'done' ? 'done' : 'pending',
    completionNote: c.completionNote ?? undefined,
    completedAt: c.completedAt ? c.completedAt.toISOString() : undefined,
    hasIssue: c.hasIssue,
  }));

  return ok({
    today,
    me: meOut,
    properties,
    checkins: unique.filter(r => r.start === today),
    checkouts: unique.filter(r => r.end === today),
    todayCleanings,
    tasks,
    checkoutToday,
  }, 200);
});
