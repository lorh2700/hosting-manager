import { prisma } from '@/lib/prisma';
import { type SessionAuth } from '@/lib/auth';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, int, query } from '@/lib/core/http';

// 게스트 명부는 숙소 단위가 아니라 사업장 단위 데이터. 호스트/관리자만 다룬다.
function requireGuestBook(auth: SessionAuth): void {
  if (!(auth.isAdmin || auth.user.role === 'host')) throw fail(403, MESSAGES.forbidden);
}

function pickGuestFields(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const name = str(body, 'name', { max: 100 }); if (name !== undefined) data.name = name.trim();
  for (const [key, max] of [['email', 200], ['phone', 40], ['source', 50], ['notes', 2000], ['lastStayAt', 10]] as const) {
    if (body[key] === null) data[key] = null;
    else { const v = str(body, key, { max }); if (v !== undefined) data[key] = v.trim() || null; }
  }
  const bookingCount = int(body, 'bookingCount', { min: 0 });
  if (bookingCount !== undefined) data.bookingCount = bookingCount;
  return data;
}

export const GET = withAuth('guests', async (req, { auth }) => {
  requireGuestBook(auth);
  const limit = Math.min(Number(query(req, 'limit')) || 500, 1000);
  const offset = Number(query(req, 'offset')) || 0;
  return ok(await prisma.guest.findMany({ orderBy: { updatedAt: 'desc' }, take: limit, skip: offset }));
});

export const POST = withAuth('guests', async (req, { auth }) => {
  requireGuestBook(auth);
  const body = await readJson(req);
  const data = pickGuestFields(body);
  if (typeof data.name !== 'string' || !data.name) throw fail(400, 'name은 필수입니다.');
  return created(await prisma.guest.create({ data: { ...data, name: data.name } }));
});

export const PUT = withAuth('guests', async (req, { auth }) => {
  requireGuestBook(auth);
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const data = pickGuestFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  return ok(await prisma.guest.update({ where: { id }, data }));
});
