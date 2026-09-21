import { prisma } from '@/lib/prisma';
import { syncBeds24Property } from '@/lib/sync-engine';

export async function runBeds24Sync() {
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
      invitationsPublished: r.invitationsPublished ?? 0,
    });
  }

  return { success: true, propertiesSynced: results.length, totalCreated, totalUpdated, totalRemoved, results };
}
