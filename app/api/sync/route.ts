import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { syncICalChannel, logSync } from '@/lib/sync-engine';

export async function POST(req: Request) {
  const body = await req.json();
  const { propertyId, triggeredBy } = body as { propertyId?: string; triggeredBy?: string };

  try {
    const db = getAdminDb();

    // Determine which properties to sync
    let propertyIds: string[] = [];
    if (propertyId) {
      propertyIds = [propertyId];
    } else {
      const propsSnap = await db.collection('properties').get();
      propertyIds = propsSnap.docs.map(d => d.id);
    }

    const results: Array<{
      propertyId: string;
      integrationId: string;
      provider: string;
      result: { eventsFound: number; eventsCreated: number; eventsUpdated: number; eventsRemoved: number; error?: string };
    }> = [];

    for (const propId of propertyIds) {
      // Track synced import URLs to avoid double-syncing
      const syncedUrls = new Set<string>();

      // 1. Fetch and process integrations (for API-based integrations like Beds24)
      const integrationsSnap = await db.collection('integrations').where('propertyId', '==', propId).where('status', '==', 'active').get();

      for (const integDoc of integrationsSnap.docs) {
        const integ = integDoc.data();
        if (integ.type !== 'ical' || !integ.config?.importUrl) continue;

        syncedUrls.add(integ.config.importUrl);

        const startTime = Date.now();
        try {
          const syncResult = await syncICalChannel(
            propId,
            integDoc.id,
            integ.config.importUrl,
            integ.provider,
          );

          const durationMs = Date.now() - startTime;
          await logSync(propId, integDoc.id, 'ical_import', syncResult, durationMs, triggeredBy ?? 'system');

          // Update integration status
          await db.collection('integrations').doc(integDoc.id).update({
            lastSyncAt: new Date().toISOString(),
            lastSyncStatus: syncResult.error ? 'failed' : 'success',
            lastErrorMessage: syncResult.error || null,
            updatedAt: new Date().toISOString(),
          });

          results.push({
            propertyId: propId,
            integrationId: integDoc.id,
            provider: integ.provider,
            result: syncResult,
          });
        } catch (err) {
          const durationMs = Date.now() - startTime;
          const errorMsg = String(err);
          await logSync(propId, integDoc.id, 'ical_import', {
            eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: errorMsg,
          }, durationMs, triggeredBy ?? 'system');

          await db.collection('integrations').doc(integDoc.id).update({
            lastSyncAt: new Date().toISOString(),
            lastSyncStatus: 'failed',
            lastErrorMessage: errorMsg,
            updatedAt: new Date().toISOString(),
          });

          results.push({
            propertyId: propId,
            integrationId: integDoc.id,
            provider: integ.provider,
            result: { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: errorMsg },
          });
        }
      }

      // 2. Sync from property-embedded channels map
      const propDoc = await db.collection('properties').doc(propId).get();
      const propData = propDoc.data();
      const channelsMap = (propData?.channels ?? {}) as Record<string, { importUrl?: string; isActive?: boolean }>;

      for (const [channelName, channelConfig] of Object.entries(channelsMap)) {
        if (!channelConfig.isActive || !channelConfig.importUrl) continue;

        // Skip if already synced via integrations
        if (syncedUrls.has(channelConfig.importUrl)) continue;

        const startTime = Date.now();
        try {
          const syncResult = await syncICalChannel(propId, channelName, channelConfig.importUrl, channelName);
          const durationMs = Date.now() - startTime;
          await logSync(propId, channelName, 'ical_import', syncResult, durationMs, triggeredBy ?? 'system');

          results.push({
            propertyId: propId,
            integrationId: channelName,
            provider: channelName,
            result: syncResult,
          });
        } catch (err) {
          const durationMs = Date.now() - startTime;
          await logSync(propId, channelName, 'ical_import', {
            eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: String(err),
          }, durationMs, triggeredBy ?? 'system');
        }
      }

      // 3. Beds24 API sync for properties with beds24PropId
      const propData2 = propDoc.data();
      if (propData2?.beds24PropId) {
        try {
          const beds24Res = await fetch(new URL('/api/beds24/sync', req.url).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propertyId: propId, beds24PropId: propData2.beds24PropId }),
          });
          const beds24Data = await beds24Res.json();
          if (beds24Res.ok) {
            results.push({
              propertyId: propId,
              integrationId: 'beds24-api',
              provider: 'beds24',
              result: {
                eventsFound: beds24Data.total || 0,
                eventsCreated: beds24Data.eventsCreated || 0,
                eventsUpdated: beds24Data.eventsUpdated || 0,
                eventsRemoved: beds24Data.eventsRemoved || 0,
              },
            });
          } else {
            results.push({
              propertyId: propId,
              integrationId: 'beds24-api',
              provider: 'beds24',
              result: { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: beds24Data.error },
            });
          }
        } catch (err) {
          results.push({
            propertyId: propId,
            integrationId: 'beds24-api',
            provider: 'beds24',
            result: { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0, error: String(err) },
          });
        }
      }

      // Update property lastSyncedAt
      await db.collection('properties').doc(propId).update({ lastSyncedAt: FieldValue.serverTimestamp() });
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
