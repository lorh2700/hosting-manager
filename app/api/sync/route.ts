import { prisma } from '@/lib/prisma';
import { syncICalChannel, syncBeds24Property, logSync } from '@/lib/sync-engine';
import { withErrors, ok, fail, MESSAGES, cronOrSession, requireManage, str } from '@/lib/core/http';

type SyncOutcome = { eventsFound: number; eventsCreated: number; eventsUpdated: number; eventsRemoved: number; error?: string };
const EMPTY: SyncOutcome = { eventsFound: 0, eventsCreated: 0, eventsUpdated: 0, eventsRemoved: 0 };

/**
 * iCal 연동 + property_channels + Beds24 를 순서대로 동기화한다.
 * 권한: 크론(x-cron-secret) 또는 로그인 세션. 특정 숙소만 동기화하면 그 숙소의 관리 권한, 전체는 관리자만.
 */
export const POST = withErrors('sync', async (req) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const propertyId = str(body, 'propertyId');
  let triggeredBy = str(body, 'triggeredBy');

  const auth = await cronOrSession(req);
  if (auth) {
    if (propertyId) requireManage(auth, propertyId);
    else if (!auth.isAdmin) throw fail(403, MESSAGES.forbidden);
    triggeredBy = triggeredBy ?? auth.user.email;
  }
  const who = triggeredBy ?? 'system';

  const propertyIds = propertyId
    ? [propertyId]
    : (await prisma.property.findMany({ select: { id: true } })).map(p => p.id);

  const results: Array<{ propertyId: string; integrationId: string; provider: string; result: SyncOutcome }> = [];

  for (const propId of propertyIds) {
    const syncedUrls = new Set<string>();

    // 1. iCal integrations
    const integrations = await prisma.integration.findMany({ where: { propertyId: propId, status: 'active', type: 'ical' } });
    for (const integ of integrations) {
      const config = integ.config as Record<string, string>;
      if (!config?.importUrl) continue;
      syncedUrls.add(config.importUrl);
      const startTime = Date.now();
      let syncResult: SyncOutcome;
      try {
        syncResult = await syncICalChannel(propId, integ.id, config.importUrl, integ.provider);
      } catch (err) {
        syncResult = { ...EMPTY, error: String(err) };
      }
      await logSync(propId, integ.id, 'ical_import', syncResult, Date.now() - startTime, who);
      await prisma.integration.update({
        where: { id: integ.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: syncResult.error ? 'failed' : 'success', lastErrorMessage: syncResult.error || null },
      });
      results.push({ propertyId: propId, integrationId: integ.id, provider: integ.provider, result: syncResult });
    }

    // 2. property_channels (iCal URLs not already covered by an integration)
    const channels = await prisma.propertyChannel.findMany({ where: { propertyId: propId, isActive: true } });
    for (const ch of channels) {
      if (!ch.importUrl || syncedUrls.has(ch.importUrl)) continue;
      const startTime = Date.now();
      let syncResult: SyncOutcome;
      try {
        syncResult = await syncICalChannel(propId, ch.name, ch.importUrl, ch.name);
      } catch (err) {
        syncResult = { ...EMPTY, error: String(err) };
      }
      await logSync(propId, ch.name, 'ical_import', syncResult, Date.now() - startTime, who);
      results.push({ propertyId: propId, integrationId: ch.name, provider: ch.name, result: syncResult });
    }

    // 3. Beds24 API sync (direct function call — no internal HTTP)
    const property = await prisma.property.findUnique({ where: { id: propId }, select: { beds24PropId: true } });
    if (property?.beds24PropId) {
      let result: SyncOutcome;
      try {
        const r = await syncBeds24Property(propId, property.beds24PropId);
        result = { eventsFound: r.total, eventsCreated: r.eventsCreated, eventsUpdated: r.eventsUpdated, eventsRemoved: r.eventsRemoved, error: r.error };
      } catch (err) {
        result = { ...EMPTY, error: String(err) };
      }
      results.push({ propertyId: propId, integrationId: 'beds24-api', provider: 'beds24', result });
    }
  }

  return ok({
    success: true,
    summary: {
      propertiesSynced: propertyIds.length,
      channelsSynced: results.length,
      eventsCreated: results.reduce((s, r) => s + r.result.eventsCreated, 0),
      eventsUpdated: results.reduce((s, r) => s + r.result.eventsUpdated, 0),
      eventsRemoved: results.reduce((s, r) => s + r.result.eventsRemoved, 0),
      errors: results.filter(r => r.result.error).length,
    },
    details: results,
  });
});
