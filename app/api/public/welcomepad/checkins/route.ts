import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Public read-only endpoint consumed by the welcome-pad Netlify function.
// Returns today's active check-in per requested property + a flat history pool
// for visit-count matching, all from our local Beds24 mirror — so welcome-pad
// no longer hits the Beds24 API directly (saves 5-min credit budget).
//
// Auth: shared secret in `x-api-key` header (env: WELCOMEPAD_API_KEY).
// Query: ?date=YYYY-MM-DD&beds24PropIds=A,B,C&historySinceDays=365

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

function splitName(title: string | null | undefined): { firstName: string; lastName: string } {
  const t = (title || '').trim();
  if (!t) return { firstName: '', lastName: '' };
  // Sync-engine sets title from `${firstName} ${lastName}` — split on first space.
  const idx = t.indexOf(' ');
  if (idx === -1) return { firstName: t, lastName: '' };
  return { firstName: t.slice(0, idx), lastName: t.slice(idx + 1) };
}

export async function GET(req: Request) {
  const expectedKey = process.env.WELCOMEPAD_API_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: 'WELCOMEPAD_API_KEY not configured' }, { status: 500 });
  }
  const providedKey = req.headers.get('x-api-key');
  if (providedKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const beds24PropIdsParam = searchParams.get('beds24PropIds');
  const historySinceDays = Number(searchParams.get('historySinceDays') || '365');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  if (!beds24PropIdsParam) {
    return NextResponse.json({ error: 'beds24PropIds is required' }, { status: 400 });
  }
  if (!Number.isFinite(historySinceDays) || historySinceDays < 1 || historySinceDays > 365 * 5) {
    return NextResponse.json({ error: 'historySinceDays must be between 1 and 1825' }, { status: 400 });
  }

  const beds24PropIds = beds24PropIdsParam.split(',').map(s => s.trim()).filter(Boolean);
  if (beds24PropIds.length === 0) {
    return NextResponse.json({ error: 'beds24PropIds is empty' }, { status: 400 });
  }

  // Resolve Beds24 IDs → internal Property UUIDs
  const properties = await prisma.property.findMany({
    where: { beds24PropId: { in: beds24PropIds } },
    select: { id: true, beds24PropId: true },
  });
  const propIdToBeds24 = new Map(properties.map(p => [p.id, p.beds24PropId!]));
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
    },
  });

  // Pick one per property — prefer ongoing stays (endDate > today) over
  // checkouts happening today, mirroring the previous Beds24 client-side sort.
  const checkins: Record<string, CheckinPayload | null> = {};
  for (const beds24Id of beds24PropIds) checkins[beds24Id] = null;

  for (const propertyId of internalPropertyIds) {
    const beds24Id = propIdToBeds24.get(propertyId)!;
    const candidates = todayEvents.filter(e => e.propertyId === propertyId);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => {
      const aOngoing = a.endDate > date ? 1 : 0;
      const bOngoing = b.endDate > date ? 1 : 0;
      return bOngoing - aOngoing;
    });
    const e = candidates[0];
    const { firstName, lastName } = splitName(e.title);
    checkins[beds24Id] = {
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

  return NextResponse.json({
    date,
    historySinceDate: sinceDateStr,
    checkins,
    history,
  });
}
