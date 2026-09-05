import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, visibleScope, readJson, dateStr, str, query, requireQuery,
} from '@/lib/core/http';

function pickTodoFields(body: Record<string, unknown>) {
  const data: { text?: string; date?: string | null; done?: boolean } = {};
  // 예전 클라이언트는 name 으로 보냈다 — text 로 통일.
  const text = str(body, 'text', { max: 500 }) ?? str(body, 'name', { max: 500 });
  if (text !== undefined) data.text = text.trim();
  if (body.date === null) data.date = null;
  else { const date = dateStr(body, 'date'); if (date) data.date = date; }
  if (typeof body.done === 'boolean') data.done = body.done;
  return data;
}

export const GET = withAuth('supply-todos', async (req, { auth }) => {
  const propertyId = query(req, 'propertyId');
  const where: Record<string, unknown> = {};
  const visible = await visibleScope(auth, propertyId ? [propertyId] : null);
  if (visible !== null) {
    if (visible.length === 0) return ok([]);
    where.propertyId = { in: visible };
  } else if (propertyId) {
    where.propertyId = propertyId;
  }
  return ok(await prisma.supplyTodo.findMany({ where, orderBy: { createdAt: 'desc' } }));
});

export const POST = withAuth('supply-todos', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const data = pickTodoFields(body);
  if (!data.text) throw fail(400, 'propertyId, text는 필수입니다.');
  requireManage(auth, propertyId);

  return created(await prisma.supplyTodo.create({
    data: { propertyId, text: data.text, date: data.date ?? null, done: data.done ?? false },
  }));
});

export const PUT = withAuth('supply-todos', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const existing = await prisma.supplyTodo.findUnique({ where: { id }, select: { propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  const data = pickTodoFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  return ok(await prisma.supplyTodo.update({ where: { id }, data }));
});

export const DELETE = withAuth('supply-todos', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const existing = await prisma.supplyTodo.findUnique({ where: { id }, select: { propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  requireManage(auth, existing.propertyId);

  await prisma.supplyTodo.delete({ where: { id } });
  return ok({ success: true });
});
