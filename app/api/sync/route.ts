import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncICalChannel, syncBeds24Property, logSync } from '@/lib/sync-engine';

export async function POST(req: Request) {
  let propertyId: string | undefined;
  let triggeredBy: string | undefined;
  try {
    const body = await req.json();
    propertyId = body.propertyId;
    triggeredBy = body.triggeredBy;
  } catch {
    // body may be empty (e.g. dashboard sync button)
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
