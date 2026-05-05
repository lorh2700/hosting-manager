import { prisma } from '@/lib/prisma';
import { getBeds24Token, BEDS24_BASE_URL, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';
import { notifyNewOpenCleanings } from '@/lib/notify';
import { v4 as uuidv4 } from 'uuid';

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

    const uid = event.uid || uuidv4();
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
      await prisma.event.create({
        data: {
          propertyId,
          channelId,
          title,
          startDate,
          endDate,
          type: eventType,
          source: provider,
          originalUid: uid,
          description: event.description || '',
        },
      });
      result.eventsCreated++;
    }
  }

  // Remove events that no longer exist in the iCal feed
  for (const [uid, existing] of existingByUid) {
    if (!seenUids.has(uid)) {
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
 * Guarantee a Cleaning row exists for every reservation checkout date on a
 * property. New cleanings are created as open (isOpen=true, no cleaner) so
 * they surface on the cleaner schedule for application. Existing cleanings
 * are untouched — assignment state, status, and notes are preserved.
 *
 * Returns the dates of cleanings actually created, so callers can notify
 * cleaners about freshly-opened slots.
 */
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

  // Cleanup: any unassigned cleaning whose date NO LONGER has a confirmed
  // reservation behind it should be removed. This handles the case where
  // an event was previously imported as a reservation and later downgraded
  // (e.g., the underlying booking became an inquiry, was cancelled, or the
  // dates shifted). Assigned cleanings are preserved — admin work matters.
  const orphans = await prisma.cleaning.findMany({
    where: {
      propertyId,
      cleanerId: null,
      date: { notIn: Array.from(checkoutDates) },
    },
    select: { id: true, date: true },
  });
  if (orphans.length > 0) {
    await prisma.cleaning.deleteMany({
      where: { id: { in: orphans.map(o => o.id) } },
    });
  }

  if (checkoutDates.size === 0) return [];

  const existing = await prisma.cleaning.findMany({
    where: { propertyId, date: { in: Array.from(checkoutDates) } },
    select: { date: true },
  });
  const existingDates = new Set(existing.map(c => c.date));

  const toCreate = Array.from(checkoutDates).filter(d => !existingDates.has(d));
  if (toCreate.length === 0) return [];

  await prisma.cleaning.createMany({
    data: toCreate.map(date => ({
      propertyId,
      date,
      status: 'pending',
      isOpen: true,
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

  const token = await getBeds24Token();

  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 1);
  const to = new Date(today);
  to.setFullYear(to.getFullYear() + 1);

  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  let allBookings: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      propertyId: String(beds24PropId),
      departureFrom: fromStr,
      departureTo: toStr,
      page: String(page),
    });

    const response = await fetch(`${BEDS24_BASE_URL}/bookings?${params}`, {
      headers: { 'token': token },
    });

    if (!response.ok) {
      const errText = await response.text();
      return { total: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: `Beds24 API 오류: ${response.status} ${errText}` };
    }

    const data = await response.json();
    const bookings: Record<string, unknown>[] = data.data || [];
    allBookings = allBookings.concat(bookings);

    if (data.pages?.nextPageExists && bookings.length > 0) {
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
      const isInquiry = isRequestStatus(b.status);
      const guestName = [b.firstName, b.lastName].filter(Boolean).join(' ')
        || (isBlack ? '차단' : isInquiry ? '문의 대기' : '게스트');
      const channelSource = isBlack ? 'manual-block' : ((b.channel as string) || (b.referer as string) || 'Beds24');

      const descriptionParts = isBlack
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
        tags: isInquiry ? ['inquiry'] : [],
        originalUid: String(b.id),
        description: descriptionParts,
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
      await prisma.event.create({ data: event });
      eventsCreated++;
    } else {
      // Detect any meaningful change including type transitions (e.g.
      // an inquiry that gets accepted moves from block → reservation).
      const titleChanged = existing.title !== event.title;
      const datesChanged = existing.startDate !== event.startDate || existing.endDate !== event.endDate;
      const typeChanged = existing.type !== event.type;
      const sourceChanged = existing.source !== event.source && existing.source !== 'manual-reservation';

      if (titleChanged || datesChanged || typeChanged || sourceChanged) {
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
          },
        });
        eventsUpdated++;
      }
    }
  }

  // Remove events that no longer exist in Beds24
  let eventsRemoved = 0;
  const existingEvents = await prisma.event.findMany({
    where: { propertyId, channelId: 'beds24' },
  });

  for (const existing of existingEvents) {
    if (existing.originalUid && !incomingUids.has(existing.originalUid)) {
      await prisma.event.delete({ where: { id: existing.id } });
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
