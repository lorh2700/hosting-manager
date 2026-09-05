import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES, requireManage, readJson, str } from '@/lib/core/http';

type Params = { id: string };

// 캘린더 상세 패널의 태그·제목·메모 편집.
export const PATCH = withAuth<Params>('admin/calendar/events', async (req, { auth, params }) => {
  const existing = await prisma.event.findUnique({ where: { id: params.id }, select: { id: true, propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  const body = await readJson(req);
  const data: Record<string, unknown> = {};
  if (Array.isArray(body.tags)) {
    data.tags = (body.tags as unknown[])
      .map(t => typeof t === 'string' ? t.trim() : '')
      .filter((t): t is string => t.length > 0 && t.length <= 40)
      .slice(0, 20);
  }
  const title = str(body, 'title', { max: 200 }); if (title !== undefined) data.title = title;
  const description = str(body, 'description', { max: 2000 }); if (description !== undefined) data.description = description;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  return ok(await prisma.event.update({
    where: { id: params.id },
    data,
    select: { id: true, tags: true, title: true, description: true },
  }));
});
