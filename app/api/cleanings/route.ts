import { staffDirectory, requireAssignee } from '@/lib/staff-directory';
import { prisma } from '@/lib/prisma';
import { canManageProperty, resolveCleaner, getCleaningPropertyIds } from '@/lib/access';
import { notifyCleaningAssigned, notifyCleaningCancelled, type CleaningCancelReason } from '@/lib/notify';
import { cleaningRole, cleaningRoleFields, lockCleaningProperty, lockCleaningSlot, requireSingleCleaning, type CleaningRole } from '@/lib/cleaning-slots';
import {
  withAuth, ok, created, fail, MESSAGES, DATE_RE,
  requireManage, visibleScope, readJson, str, idList, query, requireQuery,
} from '@/lib/core/http';

async function notifyAssignmentByCleaningId(cleaningId: string, role: CleaningRole = 'primary') {
  try {
    const cleaning = await prisma.cleaning.findUnique({
      where: { id: cleaningId },
      include: {
        property: { select: { name: true } },
        cleaner: { select: { displayName: true, phone: true, publicToken: true } },
        assistantCleaner: { select: { displayName: true, phone: true, publicToken: true } },
      },
    });
    const person = role === 'assistant' ? cleaning?.assistantCleaner : cleaning?.cleaner;
    if (!person?.phone || !person.publicToken || !cleaning) return;

    const result = await notifyCleaningAssigned({
      cleanerPhone: person.phone,
      cleanerName: person.displayName || '직원',
      cleanerToken: person.publicToken, role,
      items: [{ propertyName: cleaning.property?.name ?? '숙소', date: cleaning.date }],
    });
    if (result && !result.ok) console.error('[cleanings] notify failed:', result.error);
  } catch (e) {
    console.error('[cleanings] notify error:', e);
  }
}

async function notifyCancellationToCleaner(opts: { cleanerId: string; propertyId: string; date: string; reason: CleaningCancelReason; role?: CleaningRole }) {
  try {
    const [cleaner, property] = await Promise.all([
      staffDirectory.findUnique({ where: { id: opts.cleanerId }, select: { name: true, phone: true } }),
      prisma.property.findUnique({ where: { id: opts.propertyId }, select: { name: true } }),
    ]);
    if (!cleaner?.phone) return;
    const result = await notifyCleaningCancelled({
      cleanerPhone: cleaner.phone,
      cleanerName: cleaner.name,
      propertyName: property?.name ?? '숙소',
      date: opts.date,
      reason: opts.reason,
      role: opts.role,
    });
    if (result && !result.ok) console.error('[cleanings] cancel notify failed:', result.error);
  } catch (e) {
    console.error('[cleanings] cancel notify error:', e);
  }
}

type CleaningUpdate = {
  cleanerId?: string | null;
  assistantCleanerId?: string | null;
  assistantAssignmentType?: string | null;
  assignmentType?: string;
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
  if ('assistantCleanerId' in body) data.assistantCleanerId = typeof body.assistantCleanerId === 'string' && body.assistantCleanerId ? body.assistantCleanerId : null;
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
  const ids = query(req, 'work') === 'cleaner' ? await getCleaningPropertyIds(auth, requested) : await visibleScope(auth, requested);
  if (ids !== null) {
    if (ids.length === 0) return ok([]);
    where.propertyId = { in: ids };
  }

  const dateFrom = query(req, 'dateFrom');
  const dateTo = query(req, 'dateTo');
  if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
    throw fail(400, '조회 기간을 확인해 주세요.');
  }
  if (dateFrom || dateTo) where.date = { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
  where.status = status || { not: 'cancelled' };
  // "신청가능" = 배정자 없는 청소. isOpen 플래그는 레거시 데이터용이라 게이트로 쓰지 않는다.
  const role = cleaningRole(query(req, 'role') || undefined);
  if (isOpen === 'true') { where.origin = { not: 'interim' }; }

  let cleanings = await prisma.cleaning.findMany({
    where,
    include: { cleaner: { select: { id: true, displayName: true, phone: true } }, assistantCleaner: { select: { id: true, displayName: true, phone: true } }, applications: true },
    orderBy: { date: 'desc' },
  });

  // 신청 가능 모드에서만 dedupe: 같은 (propertyId, date) 슬롯에 배정된 청소가 있으면 미배정 행은 유령 잔재.
  if (isOpen === 'true' && cleanings.length > 0) {
    const propIds = [...new Set(cleanings.map(c => c.propertyId))];
    const dates = [...new Set(cleanings.map(c => c.date))];
    const claimed = await prisma.cleaning.findMany({
      where: { propertyId: { in: propIds }, date: { in: dates }, status: { not: 'cancelled' }, origin: { not: 'interim' } },
      select: { propertyId: true, date: true },
    });
    const counts = new Map<string, number>();
    for (const c of claimed) { const key = `${c.propertyId}|${c.date}`; counts.set(key, (counts.get(key) || 0) + 1); }
    cleanings = cleanings.filter(c => counts.get(`${c.propertyId}|${c.date}`) === 1 && c.status === 'pending'
      && (role === 'assistant' ? !c.assistantCleanerId : !c.cleanerId && !c.externalCleanerName?.trim())
      && c.cleanerId !== auth.session.userId && c.assistantCleanerId !== auth.session.userId);
  }

  return ok(cleanings.map(c => ({ ...c, cleaner: c.cleaner ? { id: c.cleaner.id, name: c.cleaner.displayName, phone: c.cleaner.phone } : null,
    assistantCleaner: c.assistantCleaner ? { id: c.assistantCleaner.id, name: c.assistantCleaner.displayName, phone: c.assistantCleaner.phone } : null })));
});

export const POST = withAuth('cleanings', async (req, { auth }) => {
  const body = await readJson(req);
  const propertyId = str(body, 'propertyId', { required: true })!;
  const date = str(body, 'date', { required: true })!;
  if (!DATE_RE.test(date)) throw fail(400, 'date는 YYYY-MM-DD 형식이어야 합니다.');
  requireManage(auth, propertyId);

  const cleanerId = str(body, 'cleanerId') || null;
  const assistantCleanerId = str(body, 'assistantCleanerId') || null;
  if (cleanerId) await requireAssignee(cleanerId, propertyId);
  if (assistantCleanerId) await requireAssignee(assistantCleanerId, propertyId);
  if (cleanerId && cleanerId === assistantCleanerId) throw fail(400, '정담당과 부담당은 서로 다른 직원이어야 합니다.');
  const cleaning = await prisma.$transaction(async tx => {
  await lockCleaningProperty(tx, propertyId); await lockCleaningSlot(tx, propertyId, date);
  const existingSlot = await tx.cleaning.findFirst({ where: { propertyId, date, status: { not: 'cancelled' }, origin: { not: 'interim' } }, select: { id: true } });
  if (existingSlot) throw fail(409, '이미 청소 일정이 있습니다. 달력을 새로고침한 뒤 기존 일정의 담당자를 변경해 주세요.');
  return tx.cleaning.create({
    data: {
      propertyId,
      date,
      cleanerId,
      assistantCleanerId, assistantAssignmentType: assistantCleanerId ? 'direct' : null,
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
  });

  if (cleaning.cleanerId) await notifyAssignmentByCleaningId(cleaning.id);
  if (cleaning.assistantCleanerId) await notifyAssignmentByCleaningId(cleaning.id, 'assistant');
  return created(cleaning);
});

export const PUT = withAuth('cleanings', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const data = pickCleaningUpdateFields(body);
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  // Whenever a cleaner is being assigned, the slot is no longer open for application.
  if ('cleanerId' in data && data.cleanerId && !('isOpen' in data)) data.isOpen = false;

  const found = await prisma.cleaning.findUnique({ where: { id }, select: { propertyId: true } });
  if (!found) throw fail(404, MESSAGES.notFound);
  const { before, cleaning } = await prisma.$transaction(async tx => {
  await lockCleaningProperty(tx, found.propertyId);
  const before = await tx.cleaning.findUnique({ where: { id } });
  if (!before) throw fail(404, MESSAGES.notFound);
  await lockCleaningSlot(tx, before.propertyId, before.date, before.origin);
  if (!canManageProperty(auth, before.propertyId)) {
    const me = await resolveCleaner(auth);
    if (!me || (before.cleanerId !== me.id && before.assistantCleanerId !== me.id)) throw fail(403, MESSAGES.forbidden);
    if (Object.keys(data).some(key => !['status', 'completionNote', 'completedAt', 'hasIssue'].includes(key))) throw fail(403, '본인 청소의 완료·문제 상태만 변경할 수 있습니다.');
  }
  if (before.origin === 'interim') throw fail(409, '중간청소는 통합 캘린더에서 처리해 주세요.');
  await requireSingleCleaning(tx, before);
  if (before.status === 'cancelled') throw fail(409, '취소된 청소는 변경할 수 없습니다.');

  if (data.cleanerId) await requireAssignee(data.cleanerId, before.propertyId);
  if (data.assistantCleanerId) await requireAssignee(data.assistantCleanerId, before.propertyId);
  const primary = 'cleanerId' in data ? data.cleanerId : before.cleanerId;
  const assistant = 'assistantCleanerId' in data ? data.assistantCleanerId : before.assistantCleanerId;
  if (primary && primary === assistant) throw fail(400, '정담당과 부담당은 서로 다른 직원이어야 합니다.');
  if (data.date && data.date !== before.date) {
    await lockCleaningSlot(tx, before.propertyId, data.date);
    if (await tx.cleaning.findFirst({ where: { propertyId: before.propertyId, date: data.date, status: { not: 'cancelled' }, origin: { not: 'interim' }, id: { not: id } }, select: { id: true } })) throw fail(409, '이동할 날짜에 이미 청소 일정이 있습니다.');
  }
  if ('cleanerId' in data) { data.assignmentType = 'direct'; data.isOpen = !data.cleanerId; }
  if ('assistantCleanerId' in data) data.assistantAssignmentType = data.assistantCleanerId ? 'direct' : null;
  if (data.status === 'done' && before.status !== 'done') data.completedAt = new Date();
  const changed = await tx.cleaning.updateMany({ where: { id, cleanerId: before.cleanerId, assistantCleanerId: before.assistantCleanerId ?? null, date: before.date }, data });
  if (changed.count !== 1) throw fail(409, '담당자가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
  const cleaning = await tx.cleaning.findUnique({ where: { id } });
  if (!cleaning) throw fail(409, '청소 일정이 변경되었습니다.');
  for (const role of ['primary', 'assistant'] as const) {
    const fields = cleaningRoleFields(role);
    if (before[fields.assignee] !== cleaning[fields.assignee]) await tx.cleaningApplication.updateMany({
      where: { cleaningId: id, role, status: { in: ['pending', 'approved'] } },
      data: { status: 'rejected', rejectedReason: '관리자가 담당자를 변경했습니다.', processedAt: new Date(), processedBy: auth.session.userId },
    });
  }
  return { before, cleaning };
  });

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
  if ('assistantCleanerId' in data && cleaning.assistantCleanerId !== before.assistantCleanerId) {
    if (before.assistantCleanerId) await notifyCancellationToCleaner({ cleanerId: before.assistantCleanerId, propertyId: before.propertyId, date: before.date,
      reason: cleaning.assistantCleanerId ? 'reassigned' : 'unassigned', role: 'assistant' });
    if (cleaning.assistantCleanerId) await notifyAssignmentByCleaningId(cleaning.id, 'assistant');
  }

  return ok(cleaning);
});

export const DELETE = withAuth('cleanings', async (req, { auth }) => {
  const id = requireQuery(req, 'id');
  const found = await prisma.cleaning.findUnique({ where: { id }, select: { propertyId: true } });
  if (!found) throw fail(404, MESSAGES.notFound);
  requireManage(auth, found.propertyId);
  const target = await prisma.$transaction(async tx => {
    await lockCleaningProperty(tx, found.propertyId);
    const current = await tx.cleaning.findUnique({ where: { id } });
    if (!current) throw fail(404, MESSAGES.notFound);
    if (current.origin === 'interim') throw fail(409, '중간청소는 통합 캘린더에서 처리해 주세요.');
    await requireSingleCleaning(tx, current);
    await tx.cleaning.delete({ where: { id } }); return current;
  });

  if (target.cleanerId) {
    await notifyCancellationToCleaner({ cleanerId: target.cleanerId, propertyId: target.propertyId, date: target.date, reason: 'deleted' });
  }
  if (target.assistantCleanerId) await notifyCancellationToCleaner({ cleanerId: target.assistantCleanerId, propertyId: target.propertyId, date: target.date, reason: 'deleted', role: 'assistant' });
  return ok({ success: true });
});
