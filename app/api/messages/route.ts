import { prisma } from '@/lib/prisma';
import { withAuth, ok, created, fail, MESSAGES, requireManage, readJson, str, idList, query } from '@/lib/core/http';

export const GET = withAuth('messages', async (req, { auth }) => {
  const eventId = query(req, 'eventId');
  const requested = idList(req, 'propertyIds');
  const where: Record<string, unknown> = {};
  if (eventId) where.eventId = eventId;

  if (auth.isAdmin) {
    if (requested) where.propertyId = { in: requested };
  } else if (auth.user.role === 'cleaner') {
    // 청소매니저는 자기가 배정된 청소가 있는 숙소의 메시지만 본다.
    const myCleaner = await prisma.cleaner.findUnique({ where: { userId: auth.session.userId }, select: { id: true } });
    if (!myCleaner) return ok([]);
    const myCleanings = await prisma.cleaning.findMany({
      where: { cleanerId: myCleaner.id }, select: { propertyId: true }, distinct: ['propertyId'],
    });
    const allowed = myCleanings.map(c => c.propertyId);
    const ids = requested ? requested.filter(id => allowed.includes(id)) : allowed;
    if (ids.length === 0) return ok([]);
    where.propertyId = { in: ids };
  } else {
    const allowed = auth.propertyIds ?? [];
    const ids = requested ? requested.filter(id => allowed.includes(id)) : allowed;
    if (ids.length === 0) return ok([]);
    where.propertyId = { in: ids };
  }

  return ok(await prisma.message.findMany({ where, orderBy: { createdAt: 'asc' } }));
});

export const POST = withAuth('messages', async (req, { auth }) => {
  const body = await readJson(req);
  const text = str(body, 'text', { required: true, max: 4000 })!;
  const sender = str(body, 'sender', { required: true, max: 20 })!;
  const propertyId = str(body, 'propertyId');
  if (propertyId) requireManage(auth, propertyId);

  const message = await prisma.message.create({
    data: {
      eventId: str(body, 'eventId') ?? null,
      propertyId: propertyId ?? null,
      guestName: str(body, 'guestName', { max: 100 }) ?? null,
      text,
      sender,
      read: typeof body.read === 'boolean' ? body.read : sender === 'host',
      ...(str(body, 'type', { max: 20 }) ? { type: str(body, 'type', { max: 20 }) } : {}),
    },
  });
  return created(message);
});

export const PUT = withAuth('messages', async (req, { auth }) => {
  const body = await readJson(req);
  const data: Record<string, unknown> = {};
  if (typeof body.read === 'boolean') data.read = body.read;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  const allowedFor = (propertyId: string | null) =>
    auth.isAdmin || (!!propertyId && (auth.propertyIds ?? []).includes(propertyId));

  if (Array.isArray(body.ids)) {
    const ids = (body.ids as unknown[]).filter((x): x is string => typeof x === 'string');
    if (!auth.isAdmin) {
      const targets = await prisma.message.findMany({ where: { id: { in: ids } }, select: { propertyId: true } });
      if (targets.some(t => !allowedFor(t.propertyId))) throw fail(403, MESSAGES.forbidden);
    }
    await prisma.message.updateMany({ where: { id: { in: ids } }, data });
    return ok({ success: true });
  }

  const id = str(body, 'id');
  if (!id) throw fail(400, 'id 또는 ids는 필수입니다.');
  const target = await prisma.message.findUnique({ where: { id }, select: { propertyId: true } });
  if (!target) throw fail(404, MESSAGES.notFound);
  if (!allowedFor(target.propertyId)) throw fail(403, MESSAGES.forbidden);

  return ok(await prisma.message.update({ where: { id }, data }));
});
