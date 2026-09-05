import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { authorizeTourOperator } from '@/lib/auth';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, requireQuery } from '@/lib/core/http';

const OPERATOR_WRITABLE_FIELDS = ['name', 'contactName', 'contactPhone', 'email', 'notifyChannel', 'notes'] as const;
type OperatorWritable = Partial<Record<typeof OPERATOR_WRITABLE_FIELDS[number], unknown>>;

function pickWritable(body: Record<string, unknown>): OperatorWritable {
  const out: OperatorWritable = {};
  for (const key of OPERATOR_WRITABLE_FIELDS) if (key in body) out[key] = body[key];
  return out;
}

const generatePublicToken = () => randomBytes(24).toString('base64url');

export const GET = withAuth('tour-operators', async (_req, { auth }) => {
  const operators = await prisma.tourOperator.findMany({
    where: auth.isAdmin ? undefined : { ownerId: auth.session.userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { tours: true } } },
  });
  return ok(operators.map(op => ({
    id: op.id, name: op.name, contactName: op.contactName, contactPhone: op.contactPhone, email: op.email,
    notifyChannel: op.notifyChannel, publicToken: op.publicToken, notes: op.notes, ownerId: op.ownerId,
    tourCount: op._count.tours, createdAt: op.createdAt,
  })));
});

export const POST = withAuth('tour-operators', async (req, { auth }) => {
  const body = await readJson(req);
  const name = str(body, 'name', { required: true })!;
  return created(await prisma.tourOperator.create({
    data: {
      ownerId: auth.session.userId,
      name,
      contactName: str(body, 'contactName') ?? null,
      contactPhone: str(body, 'contactPhone') ?? null,
      email: str(body, 'email') ?? null,
      notifyChannel: str(body, 'notifyChannel') ?? 'kakao',
      notes: str(body, 'notes') ?? null,
      publicToken: generatePublicToken(),
    },
  }));
});

export const PUT = withAuth('tour-operators', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  if (!(await authorizeTourOperator(id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const data: OperatorWritable & { publicToken?: string } = pickWritable(body);
  if (body.regenerateToken === true) data.publicToken = generatePublicToken();

  return ok(await prisma.tourOperator.update({ where: { id }, data: data as Parameters<typeof prisma.tourOperator.update>[0]['data'] }));
});

export const DELETE = withAuth('tour-operators', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  if (!(await authorizeTourOperator(id, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);
  await prisma.tourOperator.delete({ where: { id } });
  return ok({ success: true });
});
