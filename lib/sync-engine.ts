import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { beds24Get, beds24WithRetry, describeBeds24Error, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { notifyNewOpenCleanings, notifyCleaningCancelled } from '@/lib/notify';
import { todayKst, addMonthsToDateStr } from '@/lib/dates';
import { isMaintenanceNotes, maintenanceReasonFromNotes, MAINTENANCE_TITLE } from '@/lib/beds24-booking';

// ─── 동기화 정책 상수 ────────────────────────────────────────────────────────

// Beds24 조회 창 (체크아웃 기준). 웰컴패드 재방문 판정이 지난 1년 이력을 쓰므로
// 13개월을 되돌아본다. 창 밖의 로컬 이벤트는 삭제 대상에서 제외되어 이력이 보존된다.
const BEDS24_LOOKBACK_MONTHS = 13;
const BEDS24_LOOKAHEAD_MONTHS = 12;

// 대량 삭제 안전장치: 원본이 0건을 돌려주거나, 한 번에 창 안 이벤트의 절반 넘게
// (최소 10건) 사라지는 경우는 원본 오류일 가능성이 높으므로 삭제를 건너뛴다.
const MASS_REMOVAL_MIN = 10;
const MASS_REMOVAL_RATIO = 0.5;

function shouldSkipRemoval(fetched: number, existing: number, stale: number): string | null {
  if (stale === 0) return null;
  if (fetched === 0 && existing > 0) return 'source returned zero bookings while local events exist';
  if (stale >= MASS_REMOVAL_MIN && stale > existing * MASS_REMOVAL_RATIO) {
    return `mass removal guard tripped (${stale} of ${existing})`;
  }
  return null;
}

interface SyncEventRow {
  propertyId: string;
  channelId: string;
  originalUid: string;
  title: string;
  startDate: string;
  endDate: string;
  type: 'block' | 'reservation';
  source: string;
  description: string;
  tags?: string[];
  guestEmail?: string | null;
  guestPhone?: string | null;
  numAdults?: number | null;
  numChildren?: number | null;
}

// 동시에 도는 동기화(크론 + 화면 수동 버튼)가 같은 예약을 먼저 만들었으면
// 유니크 제약(P2002)으로 전체 동기화가 실패하는 대신 갱신으로 대체한다.
async function createEventTolerant(row: SyncEventRow): Promise<'created' | 'updated'> {
  try {
    await prisma.event.create({ data: row });
    return 'created';
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== 'P2002') throw e;
    const { propertyId, channelId, originalUid, ...rest } = row;
    await prisma.event.updateMany({ where: { propertyId, channelId, originalUid }, data: rest });
    return 'updated';
  }
}

// UID 가 없는 iCal 이벤트는 내용 기반의 결정적 uid 를 쓴다. 무작위 uuid 를 쓰면
// 매 동기화마다 새 이벤트가 생기고 이전 것이 삭제되는 출렁임이 생긴다.
function derivedUid(e: { start?: string; end?: string; summary?: string }): string {
  const hash = createHash('sha1').update(`${e.start ?? ''}|${e.end ?? ''}|${e.summary ?? ''}`).digest('hex');
  return `derived-${hash.slice(0, 24)}`;
}

// ─── iCal Parsing ───────────────────────────────────────────────────────────

function parseICalDate(dateStr: string): string {
  const cleanStr = dateStr.replace(/[^0-9A-Z]/gi, '');
  if (cleanStr.length >= 8) {
    const year = cleanStr.substring(0, 4);
    const month = cleanStr.substring(4, 6);
    const day = cleanStr.substring(6, 8);
    if (cleanStr.length >= 14) {
      const hour = cleanStr.substring(9, 11);
      const minute = cleanStr.substring(11, 13);
      const second = cleanStr.substring(13, 15);
      const isUTC = cleanStr.endsWith('Z');
      return isUTC
        ? `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
        : `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    }
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

interface ParsedEvent {
  start?: string;
  end?: string;
  summary?: string;
  uid?: string;
  description?: string;
}

export function parseICS(icsData: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const lines = icsData.split(/\r?\n/);
  let current: ParsedEvent | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
      i++;
      line += lines[i].substring(1);
    }
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > -1) {
        let key = line.substring(0, colonIdx);
        const value = line.substring(colonIdx + 1);
        const paramIdx = key.indexOf(';');
        if (paramIdx > -1) key = key.substring(0, paramIdx);

        if (key === 'DTSTART') current.start = parseICalDate(value);
        else if (key === 'DTEND') current.end = parseICalDate(value);
        else if (key === 'SUMMARY') current.summary = value;
        else if (key === 'UID') current.uid = value;
        else if (key === 'DESCRIPTION') current.description = value.replace(/\\[nN]/g, '\n');
      }
    }
  }
  return events;
}

// ─── Block Detection ────────────────────────────────────────────────────────

const BLOCK_KEYWORDS = [
  'not available', 'unavailable', 'blocked', 'closed', 'closure',
  'airbnb (not available)', 'booking.com (not available)',
  '닫힘', '블록', '예약 불가', '사용 불가', '예약불가', '사용불가',
];

const BLOCK_EXACT_NAMES = new Set([
  'airbnb', 'booking.com', 'agoda', 'expedia', 'vrbo', 'stayfolio',
  '에어비앤비', '부킹닷컴', '아고다', '익스피디아',
]);

function isBlockSummary(summary: string): boolean {
  const lower = summary.toLowerCase().trim();
  if (BLOCK_EXACT_NAMES.has(lower)) return true;
  return BLOCK_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Allowed Hosts ──────────────────────────────────────────────────────────

const ALLOWED_ICAL_HOSTNAMES = [
  'www.airbnb.co.kr', 'airbnb.co.kr', 'www.airbnb.com', 'airbnb.com',
  'ical.booking.com', 'beds24.com', 'www.beds24.com',
  'stayfolio.com', 'www.stayfolio.com', 'ycs.agoda.com', 'ical.agoda.com',
];

export function isAllowedICalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_ICAL_HOSTNAMES.includes(parsed.hostname);
  } catch {
    return false;
  }
}

// ─── Sync Engine ────────────────────────────────────────────────────────────

interface SyncResult {
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsRemoved: number;
  error?: string;
}

/**
 * Sync a single iCal channel: fetch, parse, upsert events, remove stale ones.
 */
export async function syncICalChannel(
  propertyId: string,
  channelId: string,
  importUrl: string,
  provider: string,
): Promise<SyncResult> {
  const result: SyncResult = { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0 };

  if (!importUrl || !isAllowedICalUrl(importUrl)) {
    result.error = `차단된 iCal URL: ${importUrl}`;
    return result;
  }

  // Fetch iCal
  const response = await fetch(importUrl);
  if (!response.ok) {
    result.error = `iCal 가져오기 실패: ${response.status} ${response.statusText}`;
    return result;
  }

  const icsData = await response.text();
  const parsedEvents = parseICS(icsData);
  result.eventsFound = parsedEvents.length;

  // Load existing events for this channel
  const existingEvents = await prisma.event.findMany({
    where: { propertyId, channelId },
  });
  const existingByUid = new Map<string, { id: string; startDate: string; endDate: string; title: string | null }>();
  for (const e of existingEvents) {
    if (e.originalUid) {
      existingByUid.set(e.originalUid, { id: e.id, startDate: e.startDate, endDate: e.endDate, title: e.title });
    }
  }

  const seenUids = new Set<string>();

  for (const event of parsedEvents) {
    if (!event.start || !event.end) continue;

    const uid = event.uid || derivedUid(event);
    seenUids.add(uid);

    const summary = event.summary ?? '';
    const isStayfolio = provider.toLowerCase() === 'stayfolio' || provider === '스테이폴리오';
    const diffMs = new Date(event.end).getTime() - new Date(event.start).getTime();
    const isOneDaySpan = diffMs <= 24 * 60 * 60 * 1000;
    const eventType = (summary && isBlockSummary(summary)) || (isStayfolio && isOneDaySpan) ? 'block' : 'reservation';

    const startDate = event.start.substring(0, 10);
    const endDate = event.end.substring(0, 10);
    const title = summary || `${provider} 예약`;

    const existing = existingByUid.get(uid);
    if (existing) {
      if (existing.startDate !== startDate || existing.endDate !== endDate || existing.title !== title) {
        await prisma.event.update({
          where: { id: existing.id },
          data: { startDate, endDate, title, type: eventType, source: provider, description: event.description || '' },
        });
        result.eventsUpdated++;
      }
    } else {
      const outcome = await createEventTolerant({
        propertyId,
        channelId,
        title,
        startDate,
        endDate,
        type: eventType,
        source: provider,
        originalUid: uid,
        description: event.description || '',
      });
      if (outcome === 'created') result.eventsCreated++;
      else result.eventsUpdated++;
    }
  }

  // Remove events that no longer exist in the iCal feed.
  // 안전장치: 피드가 비어 있거나 한꺼번에 대량으로 사라지면(피드 오류 가능성) 삭제를 건너뛴다.
  const staleIcal = Array.from(existingByUid.entries()).filter(([uid]) => !seenUids.has(uid));
  const icalGuard = shouldSkipRemoval(parsedEvents.length, existingByUid.size, staleIcal.length);
  if (icalGuard) {
    console.warn(`[sync] iCal ${provider}/${channelId} for ${propertyId}: ${icalGuard} — skipping removal of ${staleIcal.length} events`);
  } else {
    for (const [, existing] of staleIcal) {
      await prisma.event.delete({ where: { id: existing.id } });
      result.eventsRemoved++;
    }
  }

  // Drop any inquiry rows that overlap a confirmed reservation imported
  // here or earlier — best effort, never block the sync.
  await cleanupSupersededInquiries(propertyId).catch(err => {
    console.error('[sync] cleanupSupersededInquiries failed:', err);
  });

  const newCleaningDates = await ensureCleaningsForProperty(propertyId);
  if (newCleaningDates.length > 0) {
    await notifyNewOpenCleanings({ propertyId, dates: newCleaningDates }).catch(err => {
      console.error('[sync] notifyNewOpenCleanings failed:', err);
    });
  }

  return result;
}

/**
 * Drop any inquiry-type events that overlap a confirmed reservation on
 * the same property. When a guest's request-to-book turns into an actual
 * booking (or someone else snags the slot), the lingering inquiry row
 * should not keep showing up in the calendar/dashboard.
 *
 * Returns the number of inquiries removed.
 */
export async function cleanupSupersededInquiries(propertyId: string): Promise<number> {
  const reservations = await prisma.event.findMany({
    where: { propertyId, type: 'reservation' },
    select: { startDate: true, endDate: true },
  });
  if (reservations.length === 0) return 0;

  const inquiries = await prisma.event.findMany({
    where: {
      propertyId,
      type: 'block',
      tags: { has: 'inquiry' },
    },
    select: { id: true, startDate: true, endDate: true, title: true },
  });
  if (inquiries.length === 0) return 0;

  // Two ranges [s1, e1) and [s2, e2) overlap iff s1 < e2 AND e1 > s2.
  // String YYYY-MM-DD compares lexicographically the same as date order.
  const supersededIds: string[] = [];
  for (const inq of inquiries) {
    for (const res of reservations) {
      if (inq.startDate < res.endDate && inq.endDate > res.startDate) {
        supersededIds.push(inq.id);
        break;
      }
    }
  }

  if (supersededIds.length === 0) return 0;

  const removed = await prisma.event.deleteMany({
    where: { id: { in: supersededIds } },
  });
  return removed.count;
}

/**
 * 예약 체크아웃 날짜마다 Cleaning 행이 있도록 보장하고, 예약이 사라진 자동 생성
 * 청소를 정리한다.
 *
 *  - 생성: 새 청소는 origin='auto', isOpen=true(미배정) 로 만들어 청소매니저
 *    신청 화면에 노출된다.
 *  - 정리 1: origin='auto' 인데 그 날짜에 확정 예약(type='reservation')이 더 이상
 *    없는 청소(예약 취소·날짜 변경)는 배정 여부와 관계없이 삭제한다. 오늘 이후의
 *    미완료 건만 대상이며, 배정돼 있던 청소매니저에게는 취소 문자를 보낸다.
 *    관리자/웰컴패드가 만든 'manual', 파트너 API 의 'external' 은 건드리지 않는다.
 *  - 정리 2: 같은 날짜에 배정된 행이 있는데 남아 있는 미배정 자동 생성 행(유령)은
 *    신청이 붙어 있지 않으면 제거한다.
 *
 * 실제로 새로 만든 청소 날짜 목록을 돌려준다 (신규 오픈 알림용).
 */
export async function ensureCleaningsForProperty(propertyId: string): Promise<string[]> {
  // Only confirmed reservations should drive cleanings. Inquiry-type events
  // (Beds24 status='request'/'inquiry') are stored as type='block' and do
  // NOT mean a guest will actually check out — so we exclude them here.
  const reservations = await prisma.event.findMany({
    where: { propertyId, type: 'reservation' },
    select: { endDate: true },
  });

  const checkoutDates = new Set<string>();
  for (const e of reservations) {
    if (e.endDate) checkoutDates.add(e.endDate);
  }
  const checkoutList = Array.from(checkoutDates);
  const today = todayKst();

  // ── 정리 1: 예약이 사라진 자동 생성 청소 ──
  const orphans = await prisma.cleaning.findMany({
    where: {
      propertyId,
      origin: 'auto',
      status: { not: 'done' },
      date: { gte: today, notIn: checkoutList },
    },
    select: {
      id: true,
      date: true,
      cleanerId: true,
      cleaner: { select: { name: true, phone: true } },
      property: { select: { name: true } },
    },
  });
  if (orphans.length > 0) {
    await prisma.cleaning.deleteMany({
      where: { id: { in: orphans.map(o => o.id) } },
    });
    console.log(`[sync] removed ${orphans.length} orphan cleaning(s) for ${propertyId}: ${orphans.map(o => o.date).join(', ')}`);
    for (const o of orphans) {
      if (!o.cleanerId || !o.cleaner?.phone) continue;
      await notifyCleaningCancelled({
        cleanerPhone: o.cleaner.phone,
        cleanerName: o.cleaner.name,
        propertyName: o.property?.name ?? '숙소',
        date: o.date,
        reason: 'deleted',
      }).catch(err => console.error('[sync] cleaning cancel notify failed:', err));
    }
  }

  // ── 정리 2: 배정 건과 같은 날짜에 남은 미배정 자동 생성 행(유령) ──
  const ghostCandidates = await prisma.cleaning.findMany({
    where: { propertyId, origin: 'auto', cleanerId: null, date: { gte: today } },
    select: { id: true, date: true, _count: { select: { applications: true } } },
  });
  if (ghostCandidates.length > 0) {
    const assigned = await prisma.cleaning.findMany({
      where: { propertyId, date: { in: ghostCandidates.map(g => g.date) }, cleanerId: { not: null } },
      select: { date: true },
    });
    const assignedDates = new Set(assigned.map(a => a.date));
    const ghosts = ghostCandidates.filter(g => assignedDates.has(g.date) && g._count.applications === 0);
    if (ghosts.length > 0) {
      await prisma.cleaning.deleteMany({ where: { id: { in: ghosts.map(g => g.id) } } });
    }
  }

  if (checkoutDates.size === 0) return [];

  const existing = await prisma.cleaning.findMany({
    where: { propertyId, date: { in: checkoutList } },
    select: { date: true },
  });
  const existingDates = new Set(existing.map(c => c.date));

  // 오늘 이후 체크아웃만 청소를 만든다. 과거 예약이 다시 들어와도(예: 보관 기간 확대,
  // 이력 재동기화) 지난 날짜에 청소를 만들거나 "신규 오픈" 알림을 보내면 안 된다.
  const toCreate = checkoutList.filter(d => d >= today && !existingDates.has(d));
  if (toCreate.length === 0) return [];

  await prisma.cleaning.createMany({
    data: toCreate.map(date => ({
      propertyId,
      date,
      status: 'pending',
      isOpen: true,
      origin: 'auto',
    })),
  });

  return toCreate;
}

// ─── Beds24 API Sync ───────────────────────────────────────────────────────

interface Beds24SyncResult {
  total: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsRemoved: number;
  error?: string;
}

/**
 * Sync bookings from Beds24 API for a single property.
 */
export async function syncBeds24Property(
  propertyId: string,
  beds24PropId: string,
): Promise<Beds24SyncResult> {
  if (!BEDS24_REFRESH_TOKEN) {
    return { total: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: 'BEDS24_REFRESH_TOKEN is not configured' };
  }

  // 조회 창 (체크아웃 기준). 창 밖의 로컬 이벤트는 아래 삭제 단계에서 제외된다.
  const today = todayKst();
  const fromStr = addMonthsToDateStr(today, -BEDS24_LOOKBACK_MONTHS);
  const toStr = addMonthsToDateStr(today, BEDS24_LOOKAHEAD_MONTHS);

  let allBookings: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let data: {
      success?: boolean;
      error?: string;
      data?: Record<string, unknown>[];
      pages?: { nextPageExists?: boolean };
    };
    try {
      // beds24Get: 토큰 캐시·401 시 갱신·타임아웃 포함. 일시 오류는 1회 재시도.
      data = await beds24WithRetry(
        `sync bookings ${beds24PropId} p${page}`,
        () => beds24Get('/bookings', {
          propertyId: String(beds24PropId),
          departureFrom: fromStr,
          departureTo: toStr,
          page: String(page),
        }, { timeoutMs: 15_000 }),
        { attempts: 2, baseDelayMs: 1000 },
      );
    } catch (e) {
      return { total: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: `Beds24 API 오류: ${describeBeds24Error(e)}` };
    }

    if (data?.success === false) {
      return { total: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: `Beds24 API 오류: ${data.error ?? 'success=false'}` };
    }

    const bookings: Record<string, unknown>[] = Array.isArray(data?.data) ? data.data : [];
    allBookings = allBookings.concat(bookings);

    if (data?.pages?.nextPageExists && bookings.length > 0) {
      page++;
    } else {
      hasMore = false;
    }
  }

  // Beds24 booking statuses to treat as "not a confirmed reservation":
  //   - request: 예약 요청 (호스트 승인 대기)
  //   - inquiry: 단순 문의
  //   - new + statusCode logic: some channels send 'new' for inquiries
  // These still block the calendar (dates are taken in the OTA) but should
  // NOT appear as 예약 접수 in dashboards/check-in lists.
  const isRequestStatus = (status: unknown): boolean => {
    if (typeof status !== 'string') return false;
    const s = status.toLowerCase().trim();
    return s === 'request' || s === 'inquiry' || s === 'requested' || s === 'pending';
  };

  // Convert Beds24 bookings to events
  const newEvents = allBookings
    .filter((b) => b.status !== 'cancelled' && b.arrival && b.departure)
    .map((b) => {
      const isBlack = b.status === 'black';
      // 블랙아웃 중 메모가 '객실정비'로 시작하면 유지보수 차단 — 어디서 만들었든 같은 규칙.
      const isMaintenance = isBlack && isMaintenanceNotes(b.notes);
      const isInquiry = isRequestStatus(b.status);
      const guestName = isMaintenance
        ? MAINTENANCE_TITLE
        : ([b.firstName, b.lastName].filter(Boolean).join(' ')
          || (isBlack ? '차단' : isInquiry ? '문의 대기' : '게스트'));
      const channelSource = isBlack
        ? (isMaintenance ? 'maintenance' : 'manual-block')
        : ((b.channel as string) || (b.referer as string) || 'Beds24');

      const descriptionParts = isMaintenance
        ? [
            `사유: ${maintenanceReasonFromNotes(b.notes) || '(미입력)'}`,
            `채널: 객실정비`,
          ].join('\n')
        : isBlack
        ? [
            b.notes ? `${b.notes}` : '',
            `채널: Beds24 차단`,
          ].filter(Boolean).join('\n')
        : [
            isInquiry ? `※ 호스트 승인 대기 (Beds24 status: ${b.status})` : '',
            `게스트: ${guestName}`,
            b.email ? `이메일: ${b.email}` : '',
            b.phone ? `연락처: ${b.phone}` : '',
            `인원: 성인 ${b.numAdult || 0}명${b.numChild ? `, 아동 ${b.numChild}명` : ''}`,
            `채널: ${channelSource}`,
            b.price ? `금액: ₩${Number(b.price).toLocaleString()}` : '',
            b.notes ? `메모: ${b.notes}` : '',
          ].filter(Boolean).join('\n');

      const title = isInquiry
        ? `[문의] ${guestName}`
        : (guestName as string);

      // numAdult/numChild may arrive as either string or number depending on Beds24 channel.
      const adultsRaw = Number(b.numAdult ?? b.numAdults ?? 0);
      const childrenRaw = Number(b.numChild ?? b.numChildren ?? 0);

      return {
        propertyId,
        channelId: 'beds24',
        source: isInquiry ? `${channelSource} (문의)` : channelSource,
        title,
        startDate: (b.arrival as string).substring(0, 10),
        endDate: (b.departure as string).substring(0, 10),
        // Inquiries block the dates but aren't "예약" — using 'block' type
        // hides them from check-in/dashboard reservation lists.
        type: ((isBlack || isInquiry) ? 'block' : 'reservation') as 'block' | 'reservation',
        tags: isInquiry ? ['inquiry'] : isMaintenance ? ['maintenance'] : [],
        originalUid: String(b.id),
        description: descriptionParts,
        // Promote contact + party size to structured columns so downstream
        // consumers (welcome-pad check-in matching) don't have to parse description.
        // Block events have no real guest so leave them null.
        guestEmail: isBlack ? null : ((b.email as string) || null),
        guestPhone: isBlack ? null : ((b.phone as string) || (b.mobile as string) || null),
        numAdults: isBlack ? null : (Number.isFinite(adultsRaw) ? adultsRaw : null),
        numChildren: isBlack ? null : (Number.isFinite(childrenRaw) ? childrenRaw : null),
      };
    });

  const incomingUids = new Set(newEvents.map(e => e.originalUid));
  let eventsCreated = 0;
  let eventsUpdated = 0;

  for (const event of newEvents) {
    const existing = await prisma.event.findFirst({
      where: { propertyId, channelId: 'beds24', originalUid: event.originalUid },
    });

    if (!existing) {
      const outcome = await createEventTolerant(event);
      if (outcome === 'created') eventsCreated++;
      else eventsUpdated++;
    } else {
      // Detect any meaningful change including type transitions (e.g.
      // an inquiry that gets accepted moves from block → reservation).
      const titleChanged = existing.title !== event.title;
      const datesChanged = existing.startDate !== event.startDate || existing.endDate !== event.endDate;
      const typeChanged = existing.type !== event.type;
      const sourceChanged = existing.source !== event.source && existing.source !== 'manual-reservation';
      // Guest contact change detection — also drives backfill of NULLs
      // for rows that existed before the guest_* columns were added.
      const guestChanged =
        existing.guestEmail !== event.guestEmail ||
        existing.guestPhone !== event.guestPhone ||
        existing.numAdults !== event.numAdults ||
        existing.numChildren !== event.numChildren;

      if (titleChanged || datesChanged || typeChanged || sourceChanged || guestChanged) {
        // Preserve source='manual-reservation' so the calendar UI keeps
        // showing the cancel button after a sync round.
        const preservedSource = existing.source === 'manual-reservation' ? existing.source : event.source;
        await prisma.event.update({
          where: { id: existing.id },
          data: {
            startDate: event.startDate,
            endDate: event.endDate,
            title: event.title,
            description: event.description,
            source: preservedSource,
            type: event.type,
            tags: event.tags ?? [],
            guestEmail: event.guestEmail,
            guestPhone: event.guestPhone,
            numAdults: event.numAdults,
            numChildren: event.numChildren,
          },
        });
        eventsUpdated++;
      }
    }
  }

  // Remove events that no longer exist in Beds24 — 조회 창 안의 이벤트만 대상.
  // 창 밖(13개월 넘은 이력, 1년 넘게 남은 예약)은 건드리지 않아 과거 예약·메시지
  // 스레드·웰컴패드 재방문 이력이 보존된다.
  let eventsRemoved = 0;
  const existingInWindow = await prisma.event.findMany({
    where: { propertyId, channelId: 'beds24', endDate: { gte: fromStr, lte: toStr } },
    select: { id: true, originalUid: true },
  });
  const staleEvents = existingInWindow.filter(e => e.originalUid && !incomingUids.has(e.originalUid));
  const removalGuard = shouldSkipRemoval(allBookings.length, existingInWindow.length, staleEvents.length);
  if (removalGuard) {
    console.warn(`[sync] beds24 ${beds24PropId} for ${propertyId}: ${removalGuard} — skipping removal of ${staleEvents.length} events`);
  } else {
    for (const stale of staleEvents) {
      await prisma.event.delete({ where: { id: stale.id } });
      eventsRemoved++;
    }
  }

  // Drop any inquiry rows that overlap a confirmed reservation imported
  // here or earlier — best effort, never block the sync.
  await cleanupSupersededInquiries(propertyId).catch(err => {
    console.error('[sync] cleanupSupersededInquiries failed:', err);
  });

  const newCleaningDates = await ensureCleaningsForProperty(propertyId);
  if (newCleaningDates.length > 0) {
    await notifyNewOpenCleanings({ propertyId, dates: newCleaningDates }).catch(err => {
      console.error('[sync] notifyNewOpenCleanings failed:', err);
    });
  }

  return { total: newEvents.length, eventsCreated, eventsUpdated, eventsRemoved };
}

/**
 * Log a sync operation.
 */
export async function logSync(
  propertyId: string,
  channelId: string,
  syncType: string,
  result: SyncResult,
  durationMs: number,
  triggeredBy: string,
): Promise<void> {
  await prisma.syncLog.create({
    data: {
      propertyId,
      channelId,
      syncType,
      result: {
        status: result.error ? 'failed' : (result.eventsFound === 0 ? 'partial' : 'success'),
        eventsFound: result.eventsFound,
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        eventsRemoved: result.eventsRemoved,
        errorMessage: result.error || null,
      },
      durationMs,
      triggeredBy,
    },
  });
}
