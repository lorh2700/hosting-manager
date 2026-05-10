import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Public read-only endpoint consumed by the welcome-pad project.
// Auth: shared secret in `x-api-key` header (env: WELCOMEPAD_API_KEY).
//
// Two modes:
//   1) Pad mode — single property full payload (guest + match info + override)
//      Query: ?propertyKey=anon&date=YYYY-MM-DD[&historySinceDays=365]
//      Response: { date, propertyKey, guest, fallbackWelcomeMessage }
//
//   2) Cron mode — multi-property checkin map + history pool (existing)
//      Query: ?beds24PropIds=A,B,C&date=YYYY-MM-DD[&historySinceDays=365][&withMatch=1]
//      Response: { date, checkins, history, [match] }
//
// In both modes everything is sourced from our local Beds24 mirror, so the
// pad/cron no longer hit the Beds24 API directly (Beds24 has a 5-min credit budget).

type CheckinPayload = {
  bookingId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  arrival: string;
  departure: string;
  numAdults: number;
  numChildren: number;
};

type HistoryPayload = CheckinPayload & { beds24PropId: string };

type MatchInfo = {
  visitCount: number;
  weakMatchCount: number;
  matchMethod: 'email' | 'phone+name' | 'name-only' | 'none';
  isReturning: boolean;
};

type ActiveGuestPayload = CheckinPayload & {
  welcomeMessage: string | null;
  manualReturning: boolean | null;
} & MatchInfo;

function splitName(title: string | null | undefined): { firstName: string; lastName: string } {
  const t = (title || '').trim();
  if (!t) return { firstName: '', lastName: '' };
  // Sync-engine sets title from `${firstName} ${lastName}` — split on first space.
  const idx = t.indexOf(' ');
  if (idx === -1) return { firstName: t, lastName: '' };
  return { firstName: t.slice(0, idx), lastName: t.slice(idx + 1) };
}

const normEmail = (s: string | null | undefined) => (s || '').trim().toLowerCase();
const normPhone = (s: string | null | undefined) => (s || '').replace(/\D/g, '');
const normName  = (s: string | null | undefined) =>
  (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// 보수적 매칭 — 이메일 강매치 → 전화+이름 → 이름만(약매치)
// (이전 netlify get-checkin.js 의 matchVisits 와 동일한 알고리즘)
function matchVisits(target: CheckinPayload, history: HistoryPayload[]): MatchInfo {
  const tEmail = normEmail(target.email);
  const tPhone = normPhone(target.phone);
  const tName  = normName(`${target.firstName} ${target.lastName}`);

  let emailMatches = 0, phoneNameMatches = 0, nameOnlyMatches = 0;
  for (const h of history) {
    if (h.bookingId && target.bookingId && h.bookingId === target.bookingId) continue;
    const hEmail = normEmail(h.email);
    const hPhone = normPhone(h.phone);
    const hName  = normName(`${h.firstName} ${h.lastName}`);
    if (tEmail && hEmail && tEmail === hEmail) emailMatches++;
    else if (tPhone && hPhone && tPhone === hPhone && tName && hName && tName === hName) phoneNameMatches++;
    else if (tName && hName && tName === hName) nameOnlyMatches++;
  }

  const strongMatches = emailMatches + phoneNameMatches;
  let matchMethod: MatchInfo['matchMethod'] = 'none';
  if (emailMatches > 0) matchMethod = 'email';
  else if (phoneNameMatches > 0) matchMethod = 'phone+name';
  else if (nameOnlyMatches > 0) matchMethod = 'name-only';

  return {
    visitCount: strongMatches + 1,
    weakMatchCount: nameOnlyMatches,
    matchMethod,
    isReturning: strongMatches >= 1,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const propertyKey = searchParams.get('propertyKey');
  const date = searchParams.get('date');
  const beds24PropIdsParam = searchParams.get('beds24PropIds');
  const historySinceDays = Number(searchParams.get('historySinceDays') || '365');
  const includeMatch = searchParams.get('withMatch') === '1';

  // 두 호출 모드를 지원:
  // 1) cron/get-checkin.js 모드: x-api-key + beds24PropIds 다중 지점 일괄 조회
  // 2) 패드 모드: propertyKey 단일 지점 (anon, RLS 우회 위해 동일 API key 사용)
  //
  // propertyKey 모드는 hosting-manager Property.welcomepad_key 컬럼을 통해
  // 패드 client 측에서 추가 lookup 없이 바로 호출 가능.
  const expectedKey = process.env.WELCOMEPAD_API_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: 'WELCOMEPAD_API_KEY not configured' }, { status: 500 });
  }
  const providedKey = req.headers.get('x-api-key');
  if (providedKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  if (!Number.isFinite(historySinceDays) || historySinceDays < 1 || historySinceDays > 365 * 5) {
    return NextResponse.json({ error: 'historySinceDays must be between 1 and 1825' }, { status: 400 });
  }
  if (!propertyKey && !beds24PropIdsParam) {
    return NextResponse.json({ error: 'propertyKey or beds24PropIds is required' }, { status: 400 });
  }

  // Resolve target properties — 두 모드 모두 internal UUID 까지 풀어 둠
  let properties: { id: string; beds24PropId: string | null; welcomepadKey: string | null; roomReadyMessage: string | null }[];
  if (propertyKey) {
    properties = await prisma.property.findMany({
      where: { welcomepadKey: propertyKey },
      select: { id: true, beds24PropId: true, welcomepadKey: true, roomReadyMessage: true },
    });
    if (properties.length === 0) {
      return NextResponse.json({ error: `propertyKey '${propertyKey}' not found` }, { status: 404 });
    }
  } else {
    const beds24PropIds = beds24PropIdsParam!.split(',').map(s => s.trim()).filter(Boolean);
    if (beds24PropIds.length === 0) {
      return NextResponse.json({ error: 'beds24PropIds is empty' }, { status: 400 });
    }
    properties = await prisma.property.findMany({
      where: { beds24PropId: { in: beds24PropIds } },
      select: { id: true, beds24PropId: true, welcomepadKey: true, roomReadyMessage: true },
    });
  }
  const beds24PropIds = properties.map(p => p.beds24PropId).filter((v): v is string => !!v);
  const propIdToBeds24 = new Map(properties.map(p => [p.id, p.beds24PropId || '']));
  const propsById = new Map(properties.map(p => [p.id, p]));
  const internalPropertyIds = properties.map(p => p.id);

  // Date math — string comparison works because all dates are YYYY-MM-DD.
  const sinceDate = new Date(`${date}T00:00:00Z`);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - historySinceDays);
  const sinceDateStr = sinceDate.toISOString().slice(0, 10);
  const yesterdayDate = new Date(`${date}T00:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  // Today's active reservations across all requested properties.
  // Matches welcome-pad's old Beds24 query (arrivalTo=today & departureFrom=today).
  const todayEvents = await prisma.event.findMany({
    where: {
      propertyId: { in: internalPropertyIds },
      channelId: 'beds24',
      type: 'reservation',
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: {
      propertyId: true, originalUid: true, title: true,
      guestEmail: true, guestPhone: true, numAdults: true, numChildren: true,
      startDate: true, endDate: true,
      welcomeMessage: true, manualReturning: true,
    },
  });

  // Pick one per property — prefer ongoing stays (endDate > today) over
  // checkouts happening today, mirroring the previous Beds24 client-side sort.
  const checkins: Record<string, CheckinPayload | null> = {};
  // 단일 지점 모드 (propertyKey) 에서는 활성 게스트의 override 도 같이 노출.
  // 다중 지점(beds24PropIds) 모드에서는 호환성 유지를 위해 기존 shape 그대로.
  const overridesByProperty: Record<string, { welcomeMessage: string | null; manualReturning: boolean | null }> = {};
  for (const beds24Id of beds24PropIds) checkins[beds24Id] = null;

  for (const propertyId of internalPropertyIds) {
    const beds24Id = propIdToBeds24.get(propertyId) || '';
    const candidates = todayEvents.filter(e => e.propertyId === propertyId);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => {
      const aOngoing = a.endDate > date ? 1 : 0;
      const bOngoing = b.endDate > date ? 1 : 0;
      return bOngoing - aOngoing;
    });
    const e = candidates[0];
    const { firstName, lastName } = splitName(e.title);
    const payload: CheckinPayload = {
      bookingId: e.originalUid || '',
      firstName,
      lastName,
      email: e.guestEmail,
      phone: e.guestPhone,
      arrival: e.startDate,
      departure: e.endDate,
      numAdults: e.numAdults ?? 0,
      numChildren: e.numChildren ?? 0,
    };
    if (beds24Id) checkins[beds24Id] = payload;
    overridesByProperty[propertyId] = {
      welcomeMessage: e.welcomeMessage,
      manualReturning: e.manualReturning,
    };
  }

  // History pool — past reservations across the same property set, used for
  // visit-count matching. Excludes today's active stays (those are in `checkins`).
  const historyEvents = await prisma.event.findMany({
    where: {
      propertyId: { in: internalPropertyIds },
      channelId: 'beds24',
      type: 'reservation',
      startDate: { gte: sinceDateStr, lte: yesterdayStr },
    },
    select: {
      propertyId: true, originalUid: true, title: true,
      guestEmail: true, guestPhone: true, numAdults: true, numChildren: true,
      startDate: true, endDate: true,
    },
  });

  const history: HistoryPayload[] = historyEvents.map(e => {
    const { firstName, lastName } = splitName(e.title);
    return {
      bookingId: e.originalUid || '',
      beds24PropId: propIdToBeds24.get(e.propertyId) || '',
      firstName,
      lastName,
      email: e.guestEmail,
      phone: e.guestPhone,
      arrival: e.startDate,
      departure: e.endDate,
      numAdults: e.numAdults ?? 0,
      numChildren: e.numChildren ?? 0,
    };
  });

  // 단일 지점 모드 — 패드 index.html 이 호출. 게스트 + 매칭 + override 를
  // 모두 묶어 한 번에 반환해 welcomepad_current_guest 의존성을 제거함.
  if (propertyKey) {
    const prop = properties[0];
    const beds24Id = prop.beds24PropId || '';
    const checkin = beds24Id ? checkins[beds24Id] : null;
    const override = overridesByProperty[prop.id] || { welcomeMessage: null, manualReturning: null };

    const guest: ActiveGuestPayload | null = checkin
      ? {
          ...checkin,
          welcomeMessage: override.welcomeMessage,
          manualReturning: override.manualReturning,
          ...matchVisits(checkin, history),
        }
      : null;

    // 자동 매칭 결과 위에 manual_returning override 적용
    const isReturningEffective = guest
      ? (guest.manualReturning ?? guest.isReturning)
      : false;

    return NextResponse.json(
      {
        date,
        propertyKey,
        guest: guest ? { ...guest, isReturning: isReturningEffective } : null,
        // 패드의 폴백 문구 — guest.welcomeMessage 가 null 이면 호스트가 지정한
        // Property.roomReadyMessage 를 시도, 그것도 없으면 기본 문구.
        fallbackWelcomeMessage:
          (prop.roomReadyMessage && prop.roomReadyMessage.trim())
          || 'Wishing you a peaceful and comfortable stay.',
      },
      {
        headers: {
          // 패드는 60초 폴링 → 짧은 SWR 캐시로 빠른 페인트, 백그라운드 갱신.
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
        },
      },
    );
  }

  // 다중 지점 모드 (cron) — 매칭은 옵션. withMatch=1 이면 함께 반환.
  let matchByBeds24Id: Record<string, MatchInfo> | undefined;
  if (includeMatch) {
    matchByBeds24Id = {};
    for (const [beds24Id, c] of Object.entries(checkins)) {
      if (!c) continue;
      matchByBeds24Id[beds24Id] = matchVisits(c, history);
    }
  }

  return NextResponse.json({
    date,
    ...(matchByBeds24Id ? { match: matchByBeds24Id } : {}),
    historySinceDate: sinceDateStr,
    checkins,
    history,
  });
}
