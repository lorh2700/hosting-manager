import { prisma } from '@/lib/prisma';
import { notifyCleaningAssigned, notifyCleaningCancelled, type CleaningCancelReason } from '@/lib/notify';
import {
  withAuth, ok, created, fail, MESSAGES, DATE_RE,
  requireManage, visibleScope, readJson, str, idList, query, requireQuery,
} from '@/lib/core/http';

async function notifyAssignmentByCleaningId(cleaningId: string) {
  try {
    const cleaning = await prisma.cleaning.findUnique({
      where: { id: cleaningId },
      include: {
        property: { select: { name: true } },
        cleaner: { select: { name: true, phone: true, publicToken: true } },
      },
    });
    if (!cleaning?.cleaner?.phone || !cleaning.cleaner.publicToken) return;

    const result = await notifyCleaningAssigned({
      cleanerPhone: cleaning.cleaner.phone,
      cleanerName: cleaning.cleaner.name,
      cleanerToken: cleaning.cleaner.publicToken,
      items: [{ propertyName: cleaning.property?.name ?? '숙소', date: cleaning.date }],
    });
    if (result && !result.ok) console.error('[cleanings] notify failed:', result.error);
  } catch (e) {
    console.error('[cleanings] notify error:', e);
  }
}

async function notifyCancellationToCleaner(opts: { cleanerId: string; propertyId: string; date: string; reason: CleaningCancelReason }) {
  try {
    const [cleaner, property] = await Promise.all([
      prisma.cleaner.findUnique({ where: { id: opts.cleanerId }, select: { name: true, phone: true } }),
      prisma.property.findUnique({ where: { id: opts.propertyId }, select: { name: true } }),
    ]);
    if (!cleaner?.phone) return;
    const result = await notifyCleaningCancelled({
      cleanerPhone: cleaner.phone,
      cleanerName: cleaner.name,
      propertyName: property?.name ?? '숙소',
      date: opts.date,
      reason: opts.reason,
    });
    if (result && !result.ok) console.error('[cleanings] cancel notify failed:', result.error);
  } catch (e) {
    console.error('[cleanings] cancel notify error:', e);
  }
}

type CleaningUpdate = {
  cleanerId?: string | null;
  status?: string;
  supplies?: string | null;
  notes?: string | null;
  completionNote?: string | null;
  completedAt?: Date | null;
  hasIssue?: boolean;
  isOpen?: boolean;
  date?: string;
};

// PUT body 에서 허용 필드만 골라 담는다 (origin/externalSource 등은 바꿀 수 없다).
function pickCleaningUpdateFields(body: Record<string, unknown>): CleaningUpdate {
  const data: CleaningUpdate = {};
  if ('cleanerId' in body) data.cleanerId = typeof body.cleanerId === 'string' && body.cleanerId ? body.cleanerId : null;
  if (body.status === 'pending' || body.status === 'done') data.status = body.status;
  if (typeof body.supplies === 'string' || body.supplies === null) data.supplies = body.supplies as string | null;
  if (typeof body.notes === 'string' || body.notes === null) data.notes = body.notes as string | null;
  if (typeof body.completionNote === 'string' || body.completionNote === null) data.completionNote = body.completionNote as string | null;
  if (body.completedAt === null) data.completedAt = null;
  else if (typeof body.completedAt === 'string' && !Number.isNaN(Date.parse(body.completedAt))) data.completedAt = new Date(body.completedAt);
  if (typeof body.hasIssue === 'boolean') data.hasIssue = body.hasIssue;
  if (typeof body.isOpen === 'boolean') data.isOpen = body.isOpen;
  if (typeof body.date === 'string' && DATE_RE.test(body.date)) data.date = body.date;
  return data;
}

export const GET = withAuth('cleanings', async (req, { auth }) => {
  const requested = idList(req, 'propertyIds');
  const status = query(req, 'status');
  const isOpen = query(req, 'isOpen');
  const where: Record<string, unknown> = {};

  // 읽기 범위 한 규칙 (lib/access): 관리자 전체, 매니저 배정 숙소, 청소담당자 배정 지점.
  // 청소 신청(isOpen=true)도 같은 범위다 — 보이는 지점에만 신청할 수 있다.
  const ids = await visibleScope(auth, requested);
  if (ids !== null) {
    if (ids.length === 0) return ok([]);
    where.propertyId = { in: ids };
  }

  if (status) where.status = status;
  // "신청가능" = 배정자 없는 청소. isOpen 플래그는 레거시 데이터용이라 게이트로 쓰지 않는다.
  if (isOpen === 'true') where.cleanerId = null;

  let cleanings = await prisma.cleaning.findMany({
    where,
    include: { cleaner: true, applications: true },
    orderBy: { date: 'desc' },
  });

  // 신청 가능 모드에서만 dedupe: 같은 (propertyId, date) 슬롯에 배정된 청소가 있으면 미배정 행은 유령 잔재.
  if (isOpen === 'true' && cleanings.length > 0) {
    const propIds = [...new Set(cleanings.map(c => c.propertyId))];
    const dates = [...new Set(cleanings.map(c => c.date))];
    const claimed = await prisma.cleaning.findMany({
      where: { propertyId: { in: propIds }, date: { in: dates }, cleanerId: { not: null } },
      select: { propertyId: true, date: true },
    });
    const claimedSet = new Set(claimed.map(c => `${c.propertyId}|${c.date}`));
    cleanings = cleanings.filter(c => !claimedSet.has(`${c.propertyId}|${c.date}`));
  }

  return ok(cleanings);
});

export const POST = withAuth('cleanings', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const date = str(body, 'date', { required: true })!;
  if (!DATE_RE.test(date)) throw fail(400, 'date는 YYYY-MM-DD 형식이어야 합니다.');
  requireManage(auth, propertyId);

  const cleanerId = str(body, 'cleanerId') || null;
  const cleaning = await prisma.cleaning.create({
    data: {
      propertyId,
      date,
      cleanerId,
      status: body.status === 'done' ? 'done' : 'pending',
      supplies: str(body, 'supplies', { max: 1000 }) ?? null,
      notes: str(body, 'notes', { max: 2000 }) ?? null,
      // Assigning a cleaner directly closes the open-application slot.
      isOpen: cleanerId ? false : (typeof body.isOpen === 'boolean' ? body.isOpen : false),
      assignmentType: 'direct',
      // 관리자가 직접 만든 청소 — 예약 취소 정리(origin='auto') 대상이 아니다.
      origin: 'manual',
    },
  });

  if (cleaning.cleanerId) await notifyAssignmentByCleaningId(cleaning.id);
  return created(cleaning);
});

export const PUT = withAuth('cleanings', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const data = pickCleaningUpdateFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  // Whenever a cleaner is being assigned, the slot is no longer open for application.
  if ('cleanerId' in data && data.cleanerId && !('isOpen' in data)) data.isOpen = false;

  const before = await prisma.cleaning.findUnique({ where: { id }, select: { cleanerId: true, propertyId: true, date: true } });
  if (!before) throw fail(404, MESSAGES.notFound);
  requireManage(auth, before.propertyId);

  const cleaning = await prisma.cleaning.update({ where: { id }, data });

  const cleanerChanged = 'cleanerId' in data && cleaning.cleanerId !== before.cleanerId;
  if (cleanerChanged && before.cleanerId) {
    // Previous cleaner is no longer on the hook — tell them.
    await notifyCancellationToCleaner({
      cleanerId: before.cleanerId,
      propertyId: before.propertyId,
      date: before.date,
      reason: cleaning.cleanerId ? 'reassigned' : 'unassigned',
    });
  }
  if (cleanerChanged && cleaning.cleanerId) await notifyAssignmentByCleaningId(cleaning.id);

  return ok(cleaning);
});

export const DELETE = withAuth('cleanings', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const target = await prisma.cleaning.findUnique({ where: { id }, select: { propertyId: true, cleanerId: true, date: true } });
  if (!target) throw fail(404, MESSAGES.notFound);
  requireManage(auth, target.propertyId);

  await prisma.cleaning.delete({ where: { id } });

  if (target.cleanerId) {
    await notifyCancellationToCleaner({ cleanerId: target.cleanerId, propertyId: target.propertyId, date: target.date, reason: 'deleted' });
  }
  return ok({ success: true });
});
