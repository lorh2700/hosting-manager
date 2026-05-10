import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Public-but-API-key-gated endpoint that lets the welcome-pad admin UI
// override two fields on the property's currently-active reservation:
//   • welcomeMessage   — host-edited welcome text (NULL = use Property.roomReadyMessage / default)
//   • manualReturning  — force returning/new override (NULL = let auto-match decide)
//
// Auth: x-api-key header (env: WELCOMEPAD_API_KEY) — same secret as /checkins.
// Body: { propertyKey: 'anon', welcomeMessage?: string|null, manualReturning?: boolean|null }
//
// "Active reservation" = today's beds24 reservation for this property
// (startDate <= today <= endDate). If multiple, prefer ongoing stay (endDate > today)
// over today's checkout — same priority as /checkins.

type Body = {
  propertyKey?: string;
  welcomeMessage?: string | null;
  manualReturning?: boolean | null;
};

export async function POST(req: Request) {
  const expectedKey = process.env.WELCOMEPAD_API_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: 'WELCOMEPAD_API_KEY not configured' }, { status: 500 });
  }
  if (req.headers.get('x-api-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const propertyKey = (body.propertyKey || '').trim();
  if (!propertyKey) {
    return NextResponse.json({ error: 'propertyKey is required' }, { status: 400 });
  }
  // 두 필드 모두 비어있으면 호출 자체가 의미 없음
  if (!('welcomeMessage' in body) && !('manualReturning' in body)) {
    return NextResponse.json({ error: 'welcomeMessage or manualReturning is required' }, { status: 400 });
  }
  if ('manualReturning' in body
      && body.manualReturning !== null
      && typeof body.manualReturning !== 'boolean') {
    return NextResponse.json({ error: 'manualReturning must be boolean or null' }, { status: 400 });
  }
  if ('welcomeMessage' in body
      && body.welcomeMessage !== null
      && typeof body.welcomeMessage !== 'string') {
    return NextResponse.json({ error: 'welcomeMessage must be string or null' }, { status: 400 });
  }

  const property = await prisma.property.findUnique({
    where: { welcomepadKey: propertyKey },
    select: { id: true },
  });
  if (!property) {
    return NextResponse.json({ error: `propertyKey '${propertyKey}' not found` }, { status: 404 });
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const candidates = await prisma.event.findMany({
    where: {
      propertyId: property.id,
      channelId: 'beds24',
      type: 'reservation',
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: { id: true, startDate: true, endDate: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'No active reservation for today' }, { status: 404 });
  }
  // Prefer ongoing (endDate > today) over today's checkout, same as /checkins.
  candidates.sort((a, b) => {
    const aOngoing = a.endDate > today ? 1 : 0;
    const bOngoing = b.endDate > today ? 1 : 0;
    return bOngoing - aOngoing;
  });
  const activeEventId = candidates[0].id;

  // Build patch — only include keys the caller actually sent (so partial updates work).
  const patch: { welcomeMessage?: string | null; manualReturning?: boolean | null } = {};
  if ('welcomeMessage' in body)  patch.welcomeMessage  = body.welcomeMessage ?? null;
  if ('manualReturning' in body) patch.manualReturning = body.manualReturning ?? null;

  await prisma.event.update({
    where: { id: activeEventId },
    data: patch,
  });

  return NextResponse.json({ ok: true, eventId: activeEventId, applied: patch });
}
