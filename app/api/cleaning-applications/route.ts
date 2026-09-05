import { prisma } from '@/lib/prisma';
import { notifyHostOfCleaningApplication } from '@/lib/notify';
import {
  withAuth, ok, created, fail, MESSAGES,
  requireVisible, visibleScope, readJson, str, idList, query,
} from '@/lib/core/http';

const STATUSES = ['pending', 'approved', 'rejected'];

export const GET = withAuth('cleaning-applications', async (req, { auth }) => {
  const requested = idList(req, 'propertyIds');
  const where: Record<string, unknown> = {};

  if (auth.role === 'cleaner') {
    // 청소담당자는 배정 지점과 무관하게 자기 신청만 본다.
    where.applicantId = auth.session.userId;
    if (requested) where.propertyId = { in: requested };
  } else {
    const ids = await visibleScope(auth, requested);
    if (ids !== null) {
      if (ids.length === 0) return ok([]);
      where.propertyId = { in: ids };
    }
  }

  const status = query(req, 'status');
  if (status) where.status = status;

  const apps = await prisma.cleaningApplication.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { cleaning: { select: { date: true } } },
  });
  // 관리자 화면이 일정 날짜를 바로 쓰도록 cleaning.date 를 cleaningDate 로 펼친다.
  return ok(apps.map(a => ({ ...a, cleaningDate: a.cleaning?.date ?? null })));
});

/**
 * 청소 신청. 청소매니저가 미배정 청소에 신청하면 즉시 배정(선착순)되고 호스트에게 알림이 간다.
 */
export const POST = withAuth('cleaning-applications', async (req, { auth }) => {
  const body = await readJson(req);
  const cleaningId = str(body, 'cleaningId', { required: true })!;

  const cleaning = await prisma.cleaning.findUnique({
    where: { id: cleaningId },
    select: {
      id: true, propertyId: true, cleanerId: true, date: true,
      property: { select: { name: true, owner: { select: { displayName: true, email: true, phone: true } } } },
    },
  });
  if (!cleaning) throw fail(404, MESSAGES.notFound);

  // 보이는 지점에만 신청할 수 있다 (청소담당자: 배정 지점, 매니저: 배정 숙소, 관리자: 전체).
  await requireVisible(auth, cleaning.propertyId);

  if (auth.role === 'cleaner') {
    if (cleaning.cleanerId) throw fail(400, '이미 다른 담당자에게 배정된 청소입니다.');
    // 동일 (propertyId, date) 슬롯에 배정된 sibling 행이 있으면 이 미배정 행은 유령 잔재 — 신청 차단해 이중 배정 방지.
    const siblingClaimed = await prisma.cleaning.findFirst({
      where: { propertyId: cleaning.propertyId, date: cleaning.date, cleanerId: { not: null }, id: { not: cleaning.id } },
      select: { id: true },
    });
    if (siblingClaimed) throw fail(400, '이 날짜의 청소는 이미 다른 담당자에게 배정되었습니다.');
  }

  // Resolve User.id → Cleaner.id (required for FK on cleanings.cleaner_id)
  const cleaner = await prisma.cleaner.findUnique({
    where: { userId: auth.session.userId },
    select: { id: true, name: true },
  });
  if (!cleaner) throw fail(422, '청소 담당자 프로필이 없습니다. 관리자에게 등록을 요청하세요.');

  // Prevent duplicate active applications from the same cleaner.
  const existing = await prisma.cleaningApplication.findFirst({
    where: { cleaningId: cleaning.id, applicantId: auth.session.userId, status: { in: ['pending', 'approved'] } },
    select: { id: true },
  });
  if (existing) throw fail(409, '이미 신청한 청소입니다.');

  const applicantName = str(body, 'applicantName', { max: 100 })?.trim() || cleaner.name || null;
  const now = new Date();

  // Atomic: claim the cleaning if still unassigned + record the application as approved.
  // updateMany returns count=0 when another cleaner won the race.
  const createdApp = await prisma.$transaction(async (tx) => {
    const claim = await tx.cleaning.updateMany({
      where: { id: cleaning.id, cleanerId: null },
      data: { cleanerId: cleaner.id, isOpen: false, assignmentType: 'applied' },
    });
    if (claim.count === 0) return null;
    return tx.cleaningApplication.create({
      data: {
        cleaningId: cleaning.id,
        propertyId: cleaning.propertyId,
        applicantId: auth.session.userId,
        applicantName,
        status: 'approved',
        processedAt: now,
        processedBy: auth.session.userId,
      },
      select: { id: true },
    });
  });
  if (!createdApp) throw fail(409, '동시 신청이 발생했습니다. 다른 담당자가 먼저 배정되었습니다.');

  // Notify host — "X가 청소를 맡았습니다".
  notifyHostOfCleaningApplication({
    hostPhone: cleaning.property?.owner?.phone ?? null,
    hostName: cleaning.property?.owner?.displayName ?? cleaning.property?.owner?.email ?? '호스트',
    cleanerName: applicantName || '청소담당자',
    propertyName: cleaning.property?.name ?? '숙소',
    date: cleaning.date,
    applicationId: createdApp.id,
  }).catch(err => console.error('[cleaning-applications] notify failed:', err));

  return created({ ok: true, applicationId: createdApp.id });
});

export const PUT = withAuth('cleaning-applications', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;

  const target = await prisma.cleaningApplication.findUnique({ where: { id }, select: { propertyId: true, applicantId: true } });
  if (!target) throw fail(404, MESSAGES.notFound);

  // 관리자가 아니면 자기 신청만, 그것도 보이는 지점 안에서만.
  if (auth.role !== 'admin') {
    await requireVisible(auth, target.propertyId);
    if (target.applicantId !== auth.session.userId) throw fail(403, MESSAGES.forbidden);
  }

  const data: Record<string, unknown> = {};
  const status = str(body, 'status');
  if (status !== undefined) {
    if (!STATUSES.includes(status)) throw fail(400, '유효하지 않은 상태입니다.');
    data.status = status;
    if (status !== 'pending') { data.processedBy = auth.session.userId; data.processedAt = new Date(); }
  }
  if (body.rejectedReason === null) data.rejectedReason = null;
  else { const r = str(body, 'rejectedReason', { max: 500 }); if (r !== undefined) data.rejectedReason = r; }
  if (Object.keys(data).length === 0) throw fail(400, MESSAGES.noFields);

  return ok(await prisma.cleaningApplication.update({ where: { id }, data }));
});
