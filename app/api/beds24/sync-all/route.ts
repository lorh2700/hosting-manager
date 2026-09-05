import { prisma } from '@/lib/prisma';
import { syncBeds24Property } from '@/lib/sync-engine';
import { withErrors, ok, fail, MESSAGES, cronOrSession } from '@/lib/core/http';

export const maxDuration = 60;

// 모든 Beds24 연동 숙소를 순서대로 동기화한다. 권한: 크론(x-cron-secret) 또는 관리자 세션.
export const POST = withErrors('beds24/sync-all', async (req) => {
  const auth = await cronOrSession(req);
  if (auth && !auth.isAdmin) throw fail(403, MESSAGES.forbidden);

  const properties = await prisma.property.findMany({
    where: { beds24PropId: { not: null } },
    select: { id: true, name: true, beds24PropId: true },
  });

  const results = [];
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;

  for (const p of properties) {
    if (!p.beds24PropId) continue;
    const started = Date.now();
    const r = await syncBeds24Property(p.id, p.beds24PropId);
    totalCreated += r.eventsCreated;
    totalUpdated += r.eventsUpdated;
    totalRemoved += r.eventsRemoved;
    results.push({
      propertyId: p.id, propertyName: p.name, total: r.total,
      eventsCreated: r.eventsCreated, eventsUpdated: r.eventsUpdated, eventsRemoved: r.eventsRemoved,
      durationMs: Date.now() - started, error: r.error,
    });
  }

  return ok({ success: true, propertiesSynced: results.length, totalCreated, totalUpdated, totalRemoved, results });
});
