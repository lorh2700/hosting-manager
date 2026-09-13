import { normalizeIdentity } from '@/lib/guest-history';
import { prisma } from '@/lib/prisma';
import { type SessionAuth } from '@/lib/auth';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, int, query } from '@/lib/core/http';

// 게스트 명부는 숙소 단위가 아니라 사업장 단위 데이터. 관리자·매니저만 다룬다 (청소담당자 제외).
function requireGuestBook(auth: SessionAuth): void {
  if (auth.role !== 'admin') throw fail(403, MESSAGES.forbidden);
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
  const guests = await prisma.guest.findMany({ orderBy: { updatedAt: 'desc' }, take: limit, skip: offset });
  const history = await prisma.guestReservation.findMany({ where: { guestId: { in: guests.map(g => g.id) }, status: { in: ['confirmed', 'completed'] } }, select: { guestId: true } });
  const response = ok(guests.map(g => ({ ...g, bookingCount: history.filter(r => r.guestId === g.id).length })));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});

export const POST = withAuth('guests', async (req, { auth }) => {
  requireGuestBook(auth);
  const body = await readJson(req);
  const data = pickGuestFields(body);
  if (typeof data.name !== 'string' || !data.name) throw fail(400, 'name은 필수입니다.');
  return created(await prisma.guest.create({ data: { ...data, name: data.name, ...normalizeIdentity(data) } }));
});

export const PUT = withAuth('guests', async (req, { auth }) => {
  requireGuestBook(auth);
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const data = pickGuestFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);
  const existing = await prisma.guest.findUnique({ where: { id } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  return ok(await prisma.guest.update({ where: { id }, data: { ...data, ...normalizeIdentity({ ...existing, ...data }) } }));
});
