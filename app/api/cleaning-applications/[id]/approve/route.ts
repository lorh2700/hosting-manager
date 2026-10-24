import { staffDirectory, requireAssignee } from '@/lib/staff-directory';
import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES, requireManage } from '@/lib/core/http';
import { cleaningRoleFields, lockCleaningProperty, lockCleaningSlot, requireSingleCleaning } from '@/lib/cleaning-slots';

type Params = { id: string };

/**
 * Approve a cleaning application.
 *
 * Atomically:
 *   1. Resolves the applicant User.id as the assignee
 *   2. Marks the application as approved
 *   3. Assigns the cleaner to the cleaning + closes it (isOpen=false)
 *   4. Auto-rejects every other pending application for the same cleaning
 */
export const POST = withAuth<Params>('cleaning-applications/approve', async (_req, { auth, params }) => {
  const application = await prisma.cleaningApplication.findUnique({
    where: { id: params.id },
    select: { id: true, applicantId: true, cleaningId: true, propertyId: true, status: true, role: true },
  });
  if (!application) throw fail(404, MESSAGES.notFound);
  requireManage(auth, application.propertyId);

  if (application.status !== 'pending') {
    throw fail(409, `이미 처리된 신청입니다. (현재 상태: ${application.status})`);
  }

  const cleaner = await staffDirectory.findUnique({
    where: { userId: application.applicantId },
    select: { id: true, name: true },
  });
  if (!cleaner) throw fail(422, '신청자의 직원 계정을 찾을 수 없습니다.');
  await requireAssignee(cleaner.id, application.propertyId);

  const now = new Date();
  const role = application.role === 'assistant' ? 'assistant' : 'primary', fields = cleaningRoleFields(role);
  await prisma.$transaction(async tx => {
    await lockCleaningProperty(tx, application.propertyId);
    const cleaning = await tx.cleaning.findUnique({ where: { id: application.cleaningId } });
    if (!cleaning || cleaning.propertyId !== application.propertyId || cleaning.origin === 'interim') throw fail(409, '청소 일정이 변경되었습니다.');
    await lockCleaningSlot(tx, cleaning.propertyId, cleaning.date, cleaning.origin);
    await requireSingleCleaning(tx, cleaning);
    if (role === 'primary' && cleaning.externalCleanerName?.trim()) throw fail(409, '정담당은 이미 배정되었습니다.');
    if (cleaning[fields.other] === cleaner.id) throw fail(409, '정담당과 부담당을 동시에 맡을 수 없습니다.');
    const claim = await tx.cleaningApplication.updateMany({
      where: { id: application.id, status: 'pending' },
      data: { status: 'approved', processedBy: auth.session.userId, processedAt: now },
    });
    if (!claim.count) throw fail(409, '이미 처리되거나 취소된 신청입니다.');
    const assigned = await tx.cleaning.updateMany({
      where: { id: application.cleaningId, [fields.assignee]: null, status: 'pending', completedAt: null },
      data: { [fields.assignee]: cleaner.id, [fields.assignment]: 'applied', ...(role === 'primary' ? { isOpen: false } : {}) },
    });
    if (!assigned.count) throw fail(409, '이미 배정되거나 완료된 청소입니다.');
    await tx.cleaningApplication.updateMany({
      where: { cleaningId: application.cleaningId, role, id: { not: application.id }, status: 'pending' },
      data: { status: 'rejected', rejectedReason: '다른 담당자가 배정되었습니다', processedBy: auth.session.userId, processedAt: now },
    });
  });

  return ok({ success: true, cleanerId: cleaner.id, cleanerName: cleaner.name, role });
});
