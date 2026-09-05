import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, requireVisible, visibleScope, readJson, str, idList, query,
} from '@/lib/core/http';

export const GET = withAuth('cleaning-issues', async (req, { auth }) => {
  const where: Record<string, unknown> = {};
  // 청소매니저는 자기 호스트의 숙소 이슈를, 호스트는 담당 숙소 이슈를 본다.
  const visible = await visibleScope(auth, idList(req, 'propertyIds'));
  if (visible !== null) {
    if (visible.length === 0) return ok([]);
    where.propertyId = { in: visible };
  }
  const status = query(req, 'status');
  if (status) where.status = status;
  return ok(await prisma.cleaningIssue.findMany({ where, orderBy: { createdAt: 'desc' } }));
});

export const POST = withAuth('cleaning-issues', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const category = str(body, 'category', { required: true, max: 50 })!;
  const description = str(body, 'description', { required: true, max: 4000 })!;
  // 이슈 신고는 청소매니저도 자기 호스트의 숙소에 할 수 있다.
  await requireVisible(auth, propertyId);

  const urgency = str(body, 'urgency');
  const issue = await prisma.cleaningIssue.create({
    data: {
      propertyId,
      cleaningId: str(body, 'cleaningId') ?? null,
      category,
      title: str(body, 'title', { max: 200 }) ?? null,
      description,
      urgency: urgency && ['low', 'normal', 'urgent'].includes(urgency) ? urgency : 'normal',
      reportedBy: auth.session.userId,
      reportedByName: str(body, 'reportedByName', { max: 100 }) ?? auth.user.displayName ?? null,
      status: 'open',
    },
  });
  return created(issue);
});

export const PUT = withAuth('cleaning-issues', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const target = await prisma.cleaningIssue.findUnique({ where: { id }, select: { propertyId: true } });
  if (!target) throw fail(404, MESSAGES.notFound);
  // 처리(상태 변경·해결 메모)는 호스트/관리자만.
  requireManage(auth, target.propertyId);

  const data: Record<string, unknown> = {};
  const status = str(body, 'status', { max: 30 });
  if (status !== undefined) {
    data.status = status;
    if (status === 'resolved') data.resolvedBy = auth.session.userId;
  }
  if (body.resolvedNote === null) data.resolvedNote = null;
  else { const note = str(body, 'resolvedNote', { max: 2000 }); if (note !== undefined) data.resolvedNote = note; }
  const category = str(body, 'category', { max: 50 }); if (category !== undefined) data.category = category;
  const title = str(body, 'title', { max: 200 }); if (title !== undefined) data.title = title;
  const description = str(body, 'description', { max: 4000 }); if (description !== undefined) data.description = description;
  const urgency = str(body, 'urgency'); if (urgency && ['low', 'normal', 'urgent'].includes(urgency)) data.urgency = urgency;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  return ok(await prisma.cleaningIssue.update({ where: { id }, data }));
});
