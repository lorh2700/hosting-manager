import { prisma } from '@/lib/prisma';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireManage, requireVisible, visibleScope, readJson, str, idList, query,
} from '@/lib/core/http';
import { z } from 'zod';
import { createHash } from 'node:crypto';

// Kept inside existing items JSON to retain the original request without a migration.
// Only the server writes this key; it is omitted from every API response.
const CREATION_FINGERPRINT_KEY = '_creationRequestFingerprint';

const supplyItem = z.object({
  name: z.string().trim().min(1, '품목 이름을 입력해주세요.').max(60),
  quantity: z.number().int().positive('수량은 1개 이상이어야 합니다.').max(10000),
  unit: z.string().trim().min(1).max(20).optional(),
  note: z.string().max(1000).nullable().optional(),
});
const createSupply = z.object({
  id: z.string().uuid().optional(),
  propertyId: z.string().trim().min(1),
  text: z.string().transform(value => value.replace(/\r\n/g, '\n').trim())
    .pipe(z.string().min(1, '요청 내용을 입력해주세요.').max(2000, '요청 내용은 2000자 이하로 입력해주세요.')).optional(),
  items: z.array(supplyItem).min(1).max(30).optional(),
  urgency: z.enum(['low', 'normal', 'urgent']).default('normal'),
  statusNote: z.string().max(1000).nullable().optional(),
}).superRefine((input, context) => {
  if (input.text !== undefined && input.items !== undefined) context.addIssue({ code: 'custom', message: '요청 내용과 품목 목록은 함께 보낼 수 없습니다.' });
  if (input.text === undefined && input.items === undefined) context.addIssue({ code: 'custom', message: '요청 내용을 입력해주세요.' });
});
function itemFingerprint(value: unknown): string | null {
  const parsed = z.array(supplyItem).safeParse(value);
  if (!parsed.success) return null;
  return JSON.stringify(parsed.data.map(item => ({ name: item.name, quantity: item.quantity, unit: item.unit ?? null, note: item.note ?? null }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function creationFingerprint(input: z.infer<typeof createSupply>, actorId: string): string {
  const content = input.text !== undefined ? { kind: 'text', text: input.text } : { kind: 'items', items: itemFingerprint(input.items) };
  return createHash('sha256').update(JSON.stringify({ actorId, propertyId: input.propertyId, ...content,
    urgency: input.urgency, statusNote: input.statusNote ?? null })).digest('hex');
}
// Requests made by the previous structured-items API have no type in their hash.
function legacyCreationFingerprint(input: z.infer<typeof createSupply>, actorId: string): string | undefined {
  if (input.text !== undefined) return undefined;
  return createHash('sha256').update(JSON.stringify({ actorId, propertyId: input.propertyId, items: itemFingerprint(input.items),
    urgency: input.urgency, statusNote: input.statusNote ?? null })).digest('hex');
}
function storedText(items: unknown): string | undefined {
  if (!Array.isArray(items) || items.length !== 1) return undefined;
  const entry = items[0];
  return entry && typeof entry === 'object' && entry.kind === 'text' && typeof entry.text === 'string' ? entry.text : undefined;
}
function storedFingerprint(items: unknown): string | undefined {
  const first = Array.isArray(items) ? items[0] : undefined;
  if (!first || typeof first !== 'object') return undefined;
  const value = (first as Record<string, unknown>)[CREATION_FINGERPRINT_KEY];
  return typeof value === 'string' ? value : undefined;
}
function publicRequest<T extends { items: unknown }>(request: T): T & { requestText?: string } {
  const requestText = storedText(request.items);
  if (requestText !== undefined) return { ...request, requestText, items: [] };
  const items = Array.isArray(request.items) ? request.items.map(item => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== CREATION_FINGERPRINT_KEY)) : item) : request.items;
  return { ...request, items };
}

export const GET = withAuth('supply-requests', async (req, { auth }) => {
  const requestedTake = query(req, 'take');
  const take = requestedTake === null ? 100 : Number(requestedTake);
  if (!Number.isInteger(take) || take < 1 || take > 200) throw fail(400, 'take는 1부터 200 사이의 정수여야 합니다.');
  const where: Record<string, unknown> = {};
  // 청소매니저는 자기 호스트의 숙소 요청을, 호스트는 담당 숙소 요청을 본다.
  const visible = await visibleScope(auth, idList(req, 'propertyIds'));
  if (visible !== null) {
    if (visible.length === 0) return ok([]);
    where.propertyId = { in: visible };
  }
  const status = query(req, 'status');
  if (status) where.status = status;
  const requests = await prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  return ok(requests.map(publicRequest));
});

export const POST = withAuth('supply-requests', async (req, { auth }) => {
  const parsed = createSupply.safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, parsed.error.issues[0].message);
  const input = parsed.data;
  const { propertyId } = input;
  // 청소매니저도 자기가 청소하는 숙소에는 요청을 올릴 수 있다.
  await requireVisible(auth, propertyId);

  const fingerprint = creationFingerprint(input, auth.session.userId);
  function retry(existing: NonNullable<Awaited<ReturnType<typeof prisma.supplyRequest.findUnique>>>) {
    const saved = storedFingerprint(existing.items);
    const sameContents = saved ? saved === fingerprint || saved === legacyCreationFingerprint(input, auth.session.userId)
      : existing.urgency === input.urgency && (existing.statusNote ?? null) === (input.statusNote ?? null)
        && (input.text !== undefined ? storedText(existing.items) === input.text : storedText(existing.items) === undefined
          && itemFingerprint(existing.items) === itemFingerprint(input.items));
    if (existing.requestedBy !== auth.session.userId || existing.propertyId !== propertyId
      || !sameContents) {
      throw fail(409, '같은 요청 번호로 다른 내용을 저장할 수 없습니다. 새 요청으로 등록해주세요.');
    }
    return ok(publicRequest(existing));
  }
  if (input.id) {
    const existing = await prisma.supplyRequest.findUnique({ where: { id: input.id } });
    if (existing) return retry(existing);
  }
  try {
    const request = await prisma.supplyRequest.create({
      data: {
        ...(input.id ? { id: input.id } : {}), propertyId,
        requestedBy: auth.session.userId,
        requestedByName: (auth.user.displayName || auth.user.email).slice(0, 100),
        // Text is a reserved content record, never a made-up product quantity.
        items: input.text !== undefined ? [{ kind: 'text', text: input.text, [CREATION_FINGERPRINT_KEY]: fingerprint }]
          : input.items!.map((item, index) => index === 0 ? { ...item, [CREATION_FINGERPRINT_KEY]: fingerprint } : item),
        urgency: input.urgency, status: 'pending',
        statusNote: input.statusNote ?? null,
      },
    });
    return created(publicRequest(request));
  } catch (error) {
    if (input.id && error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      const concurrent = await prisma.supplyRequest.findUnique({ where: { id: input.id } });
      if (concurrent) return retry(concurrent);
    }
    throw error;
  }
});

export const PUT = withAuth('supply-requests', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const existing = await prisma.supplyRequest.findUnique({ where: { id }, select: { propertyId: true } });
  if (!existing) throw fail(404, MESSAGES.notFound);
  // 처리 상태 변경은 호스트/관리자만.
  requireManage(auth, existing.propertyId);

  const data: { status?: string; statusNote?: string | null; urgency?: string } = {};
  const status = str(body, 'status', { max: 20 }); if (status !== undefined) data.status = status;
  if (body.statusNote !== undefined) data.statusNote = typeof body.statusNote === 'string' ? body.statusNote : null;
  const urgency = str(body, 'urgency', { max: 20 }); if (urgency !== undefined) data.urgency = urgency;
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  return ok(publicRequest(await prisma.supplyRequest.update({ where: { id }, data })));
});
