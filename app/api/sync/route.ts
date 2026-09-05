import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncICalChannel, syncBeds24Property, logSync } from '@/lib/sync-engine';
import { getSessionWithUser, canManageProperty } from '@/lib/auth';

export async function POST(req: Request) {
  let propertyId: string | undefined;
  let triggeredBy: string | undefined;
  try {
    const body = await req.json();
    propertyId = typeof body.propertyId === 'string' ? body.propertyId : undefined;
    triggeredBy = typeof body.triggeredBy === 'string' ? body.triggeredBy : undefined;
  } catch {
    // body may be empty (e.g. dashboard sync button)
  }

  // 권한: 크론(x-cron-secret) 또는 로그인 세션. 특정 숙소만 동기화하면 그 숙소의
  // 관리 권한, 전체 동기화는 관리자만. (이전에는 완전 공개 경로였다.)
  const cronSecret = process.env.CRON_SECRET;
  const cronHeader = req.headers.get('x-cron-secret');
  const viaCron = !!cronHeader && !!cronSecret && cronHeader === cronSecret;
  if (!viaCron) {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const allowed = propertyId ? canManageProperty(auth, propertyId) : auth.isAdmin;
    if (!allowed) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    triggeredBy = triggeredBy ?? auth.user.email;
  }

  try {
    // Determine which properties to sync
    let propertyIds: string[] = [];
    if (propertyId) {
      propertyIds = [propertyId];
    } else {
      const props = await prisma.property.findMany({ select: { id: true } });
      propertyIds = props.map((p: { id: string }) => p.id);
    }

    const results: Array<{
      propertyId: string;
      integrationId: string;
      provider: string;
      result: { eventsFound: number; eventsCreated: number; eventsUpdated: number; eventsRemoved: number; error?: string };
    }> = [];

    for (const propId of propertyIds) {
      const syncedUrls = new Set<string>();

      // 1. Sync integrations (iCal)
      const integrations = await prisma.integration.findMany({
        where: { propertyId: propId, status: 'active', type: 'ical' },
      });

      for (const integ of integrations) {
        const config = integ.config as Record<string, string>;
        if (!config?.importUrl) continue;

        syncedUrls.add(config.importUrl);
        const startTime = Date.now();

        try {
          const syncResult = await syncICalChannel(propId, integ.id, config.importUrl, integ.provider);
          const durationMs = Date.now() - startTime;
          await logSync(propId, integ.id, 'ical_import', syncResult, durationMs, triggeredBy ?? 'system');

          await prisma.integration.update({
            where: { id: integ.id },
            data: {
              lastSyncAt: new Date(),
              lastSyncStatus: syncResult.error ? 'failed' : 'success',
              lastErrorMessage: syncResult.error || null,
            },
          });

          results.push({ propertyId: propId, integrationId: integ.id, provider: integ.provider, result: syncResult });
        } catch (err) {
          const durationMs = Date.now() - startTime;
          const errorMsg = String(err);
          await logSync(propId, integ.id, 'ical_import', {
            eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: errorMsg,
          }, durationMs, triggeredBy ?? 'system');

          await prisma.integration.update({
            where: { id: integ.id },
            data: { lastSyncAt: new Date(), lastSyncStatus: 'failed', lastErrorMessage: errorMsg },
          });

          results.push({
            propertyId: propId, integrationId: integ.id, provider: integ.provider,
            result: { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: errorMsg },
          });
        }
      }

      // 2. Sync from property_channels
      const channels = await prisma.propertyChannel.findMany({
        where: { propertyId: propId, isActive: true },
      });

      for (const ch of channels) {
        if (!ch.importUrl || syncedUrls.has(ch.importUrl)) continue;

        const startTime = Date.now();
        try {
          const syncResult = await syncICalChannel(propId, ch.name, ch.importUrl, ch.name);
          const durationMs = Date.now() - startTime;
          await logSync(propId, ch.name, 'ical_import', syncResult, durationMs, triggeredBy ?? 'system');
          results.push({ propertyId: propId, integrationId: ch.name, provider: ch.name, result: syncResult });
        } catch (err) {
          const durationMs = Date.now() - startTime;
          await logSync(propId, ch.name, 'ical_import', {
            eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: String(err),
          }, durationMs, triggeredBy ?? 'system');
        }
      }

      // 3. Beds24 API sync (direct function call — no internal HTTP)
      const property = await prisma.property.findUnique({ where: { id: propId }, select: { beds24PropId: true } });
      if (property?.beds24PropId) {
        try {
          const beds24Data = await syncBeds24Property(propId, property.beds24PropId);
          results.push({
            propertyId: propId, integrationId: 'beds24-api', provider: 'beds24',
            result: {
              eventsFound: beds24Data.total, eventsCreated: beds24Data.eventsCreated,
              eventsUpdated: beds24Data.eventsUpdated, eventsRemoved: beds24Data.eventsRemoved,
              error: beds24Data.error,
            },
          });
        } catch (err) {
          results.push({
            propertyId: propId, integrationId: 'beds24-api', provider: 'beds24',
            result: { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: String(err) },
          });
        }
      }
    }

    const totalCreated = results.reduce((s, r) => s + r.result.eventsCreated, 0);
    const totalUpdated = results.reduce((s, r) => s + r.result.eventsUpdated, 0);
    const totalRemoved = results.reduce((s, r) => s + r.result.eventsRemoved, 0);
    const errors = results.filter(r => r.result.error);

    return NextResponse.json({
      success: true,
      summary: {
        propertiesSynced: propertyIds.length,
        channelsSynced: results.length,
        eventsCreated: totalCreated,
        eventsUpdated: totalUpdated,
        eventsRemoved: totalRemoved,
        errors: errors.length,
      },
      details: results,
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
