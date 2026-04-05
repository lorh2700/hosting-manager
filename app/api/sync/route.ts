import { NextResponse } from 'next/server';
import { collection, getDocs, query, where, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { syncICalChannel, logSync } from '@/lib/sync-engine';

export async function POST(req: Request) {
  const body = await req.json();
  const { propertyId, triggeredBy } = body as { propertyId?: string; triggeredBy?: string };

  try {
    // Determine which properties to sync
    let propertyIds: string[] = [];
    if (propertyId) {
      propertyIds = [propertyId];
    } else {
      const propsSnap = await getDocs(collection(db, 'properties'));
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
      const integrationsSnap = await getDocs(
        query(collection(db, 'integrations'), where('propertyId', '==', propId), where('status', '==', 'active'))
      );

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
          await updateDoc(doc(db, 'integrations', integDoc.id), {
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

          await updateDoc(doc(db, 'integrations', integDoc.id), {
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
      const propDoc = await getDoc(doc(db, 'properties', propId));
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

      // Update property lastSyncedAt
      await updateDoc(doc(db, 'properties', propId), { lastSyncedAt: serverTimestamp() });
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
