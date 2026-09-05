import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, visibleScope, readJson, dateStr, str, idList, query, requireQuery,
} from '@/lib/core/http';

// body 를 그대로 Prisma 에 넘기지 않는다 — 허용 필드만 골라 담는다.
function pickEventFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const start = dateStr({ v: body.startDate ?? body.start }, 'v');
  const end = dateStr({ v: body.endDate ?? body.end }, 'v');
  if (start) data.startDate = start;
  if (end) data.endDate = end;
  const title = str(body, 'title', { max: 200 });
  if (title !== undefined) data.title = title;
  const description = str(body, 'description', { max: 2000 });
  if (description !== undefined) data.description = description;
  if (body.type === 'block' || body.type === 'reservation') data.type = body.type;
  const source = str(body, 'source', { max: 100 });
  if (source !== undefined) data.source = source;
  const channelId = str(body, 'channelId', { max: 100 });
  if (channelId !== undefined) data.channelId = channelId;
  const originalUid = str(body, 'originalUid', { max: 200 });
  if (originalUid !== undefined) data.originalUid = originalUid;
  if (Array.isArray(body.tags)) {
    data.tags = (body.tags as unknown[])
      .map(t => (typeof t === 'string' ? t.trim() : ''))
      .filter(t => t.length > 0 && t.length <= 40)
      .slice(0, 20);
  }
  return data;
}

export const GET = withAuth('events', async (req, { auth }) => {
  const where: Record<string, unknown> = {};
  const visible = await visibleScope(auth, idList(req, 'propertyIds'));
  if (visible !== null) {
    if (visible.length === 0) return ok([]);
    where.propertyId = { in: visible };
  }
  const type = query(req, 'type');
  if (type) where.type = type;

  const limit = Math.min(Number(query(req, 'limit')) || 1000, 2000);
  const offset = Number(query(req, 'offset')) || 0;

  const events = await prisma.event.findMany({ where, orderBy: { startDate: 'asc' }, take: limit, skip: offset });
  return ok(events);
});

export const POST = withAuth('events', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  requireManage(auth, propertyId);

  const data = pickEventFields(body);
  if (typeof data.startDate !== 'string' || typeof data.endDate !== 'string') {
    throw fail(400, 'startDate, endDate(YYYY-MM-DD)는 필수입니다.');
  }
  if (data.startDate >= data.endDate) throw fail(400, '종료일은 시작일보다 뒤여야 합니다.');

  const event = await prisma.event.create({
    data: {
      propertyId,
      channelId: (data.channelId as string | undefined) ?? null,
      source: (data.source as string | undefined) ?? null,
      title: (data.title as string | undefined) ?? null,
      startDate: data.startDate,
      endDate: data.endDate,
      type: (data.type as string | undefined) ?? 'reservation',
      originalUid: (data.originalUid as string | undefined) ?? null,
      description: (data.description as string | undefined) ?? null,
      tags: (data.tags as string[] | undefined) ?? [],
    },
  });
  return created(event);
});

export const PUT = withAuth('events', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;

  const existing = await prisma.event.findUnique({ where: { id }, select: { propertyId: true, startDate: true, endDate: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  const data = pickEventFields(body);
  // 다른 숙소·다른 원본으로 옮기는 것은 허용하지 않는다.
  delete data.channelId;
  delete data.originalUid;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  const nextStart = (data.startDate as string | undefined) ?? existing.startDate;
  const nextEnd = (data.endDate as string | undefined) ?? existing.endDate;
  if (nextStart >= nextEnd) throw fail(400, '종료일은 시작일보다 뒤여야 합니다.');

  return ok(await prisma.event.update({ where: { id }, data }));
});

export const DELETE = withAuth('events', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const existing = await prisma.event.findUnique({ where: { id }, select: { propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  await prisma.event.delete({ where: { id } });
  return ok({ success: true });
});
