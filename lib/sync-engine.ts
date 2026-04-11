import { prisma } from '@/lib/prisma';
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

  return result;
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
