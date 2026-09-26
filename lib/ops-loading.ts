import { todayKst } from './dates';
/** Keep just one account/scope snapshot in memory; never persist guest data. */
export function createOpsSnapshotCache<T extends { today: string }>(ttlMs = 60000) {
  let entry: { key: string; data: T; savedAt: number } | null = null;
  return {
    read(key: string, now = Date.now()) {
      if (!entry || !key || entry.key !== key || now - entry.savedAt >= ttlMs || entry.data.today !== todayKst(new Date(now))) return null;
      return entry;
    },
    write(key: string, data: T, now = Date.now()) { if (key) entry = { key, data, savedAt: now }; },
    clear() { entry = null; },
  };
}
/** Ordered results with bounded DB concurrency, instead of a query burst. */
export async function mapOpsReads<T, R>(items: readonly T[], read: (item: T) => Promise<R>, concurrency = 2): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await read(items[index]);
    }
  }));
  return results;
}
