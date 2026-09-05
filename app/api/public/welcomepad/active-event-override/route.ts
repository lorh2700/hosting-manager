import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, readJson } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';

// 웰컴패드 관리 화면이 오늘 활성 예약의 두 필드를 덮어쓴다:
//   • welcomeMessage  — 호스트가 편집한 환영문구 (NULL = 기본값)
//   • manualReturning — 재방문 수동 판정 (NULL = 자동 매칭)
// Auth: x-api-key (env WELCOMEPAD_API_KEY) — /checkins 와 같은 비밀키.
type Body = { propertyKey?: string; welcomeMessage?: string | null; manualReturning?: boolean | null };

export const POST = withErrors('welcomepad/active-event-override', async (req) => {
  const expectedKey = process.env.WELCOMEPAD_API_KEY;
  if (!expectedKey) throw fail(500, 'WELCOMEPAD_API_KEY not configured');
  if (req.headers.get('x-api-key') !== expectedKey) throw fail(401, 'Unauthorized');

  const body = await readJson<Body>(req);
  const propertyKey = (body.propertyKey || '').trim();
  if (!propertyKey) throw fail(400, 'propertyKey is required');
  if (!('welcomeMessage' in body) && !('manualReturning' in body)) throw fail(400, 'welcomeMessage or manualReturning is required');
  if ('manualReturning' in body && body.manualReturning !== null && typeof body.manualReturning !== 'boolean') throw fail(400, 'manualReturning must be boolean or null');
  if ('welcomeMessage' in body && body.welcomeMessage !== null && typeof body.welcomeMessage !== 'string') throw fail(400, 'welcomeMessage must be string or null');

  const property = await prisma.property.findUnique({ where: { welcomepadKey: propertyKey }, select: { id: true } });
  if (!property) throw fail(404, `propertyKey '${propertyKey}' not found`);

  const today = todayKst();
  const candidates = await prisma.event.findMany({
    where: { propertyId: property.id, channelId: 'beds24', type: 'reservation', startDate: { lte: today }, endDate: { gte: today } },
    select: { id: true, startDate: true, endDate: true },
  });
  if (candidates.length === 0) throw fail(404, 'No active reservation for today');
  // Prefer ongoing (endDate > today) over today's checkout, same as /checkins.
  candidates.sort((a, b) => (b.endDate > today ? 1 : 0) - (a.endDate > today ? 1 : 0));
  const activeEventId = candidates[0].id;

  const patch: { welcomeMessage?: string | null; manualReturning?: boolean | null } = {};
  if ('welcomeMessage' in body) patch.welcomeMessage = body.welcomeMessage ?? null;
  if ('manualReturning' in body) patch.manualReturning = body.manualReturning ?? null;

  await prisma.event.update({ where: { id: activeEventId }, data: patch });
  return ok({ ok: true, eventId: activeEventId, applied: patch });
});
