import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncBeds24Property } from '@/lib/sync-engine';
import { getSessionWithUser } from '@/lib/auth';

export const maxDuration = 60;

async function isAuthorized(req: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get('x-cron-secret');
    if (header && header === cronSecret) return true;
  }
  const auth = await getSessionWithUser(req);
  return !!auth?.isAdmin;
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      const durationMs = Date.now() - started;

      totalCreated += r.eventsCreated;
      totalUpdated += r.eventsUpdated;
      totalRemoved += r.eventsRemoved;

      results.push({
        propertyId: p.id,
        propertyName: p.name,
        total: r.total,
        eventsCreated: r.eventsCreated,
        eventsUpdated: r.eventsUpdated,
        eventsRemoved: r.eventsRemoved,
        durationMs,
        error: r.error,
      });
    }

    return NextResponse.json({
      success: true,
      propertiesSynced: results.length,
      totalCreated,
      totalUpdated,
      totalRemoved,
      results,
    });
  } catch (err) {
    console.error('Beds24 sync-all error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal error', message }, { status: 500 });
  }
}
