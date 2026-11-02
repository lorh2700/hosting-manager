import type { JongnoEvent, Prisma } from '../generated/prisma/client';
import type { JongnoEventQuery } from './jongno-events';

export async function listFestivalFirstEvents(
  events: Prisma.TransactionClient['jongnoEvent'],
  where: Prisma.JongnoEventWhereInput,
  query: Pick<JongnoEventQuery, 'category' | 'cursor' | 'limit'>,
): Promise<JongnoEvent[]> {
  const cursor = query.cursor
    ? await events.findFirst({ where: { ...where, id: query.cursor }, select: { id: true, category: true, startDate: true } })
    : null;
  if (query.cursor && !cursor) return [];

  const groups = query.category ? [query.category] : ['festival', { not: 'festival' }];
  const rows: JongnoEvent[] = [];
  for (const category of groups) {
    if (category === 'festival' && cursor && cursor.category !== 'festival') continue;
    const resume = cursor && (typeof category === 'string' ? cursor.category === category : cursor.category !== 'festival');
    const batch = await events.findMany({
      where: { ...where, category, ...(resume ? { OR: [
        { startDate: { gt: cursor.startDate } },
        { startDate: cursor.startDate, id: { gt: cursor.id } },
      ] } : {}) },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: query.limit + 1 - rows.length,
    });
    rows.push(...batch);
    if (rows.length > query.limit) break;
  }
  return rows;
}
