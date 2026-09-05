import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, MESSAGES, requireManage } from '@/lib/core/http';

type Params = { id: string };

/**
 * Approve a cleaning application.
 *
 * Atomically:
 *   1. Resolves the applicant (User.id) → Cleaner.id
 *   2. Marks the application as approved
 *   3. Assigns the cleaner to the cleaning + closes it (isOpen=false)
 *   4. Auto-rejects every other pending application for the same cleaning
 */
export const POST = withAuth<Params>('cleaning-applications/approve', async (_req, { auth, params }) => {
  const application = await prisma.cleaningApplication.findUnique({
    where: { id: params.id },
    select: { id: true, applicantId: true, cleaningId: true, propertyId: true, status: true },
  });
  if (!application) throw fail(404, MESSAGES.notFound);
  requireManage(auth, application.propertyId);

  if (application.status !== 'pending') {
    throw fail(409, `이미 처리된 신청입니다. (현재 상태: ${application.status})`);
  }

  const cleaner = await prisma.cleaner.findUnique({
    where: { userId: application.applicantId },
    select: { id: true, name: true },
  });
  if (!cleaner) throw fail(422, '신청자의 청소 담당자 프로필이 없습니다. 먼저 청소 담당자로 등록해주세요.');

  const now = new Date();
  await prisma.$transaction([
    prisma.cleaningApplication.update({
      where: { id: application.id },
      data: { status: 'approved', processedBy: auth.session.userId, processedAt: now },
    }),
    prisma.cleaning.update({
      where: { id: application.cleaningId },
      data: { cleanerId: cleaner.id, isOpen: false, assignmentType: 'applied' },
    }),
    prisma.cleaningApplication.updateMany({
      where: { cleaningId: application.cleaningId, id: { not: application.id }, status: 'pending' },
      data: { status: 'rejected', rejectedReason: '다른 담당자가 배정되었습니다', processedBy: auth.session.userId, processedAt: now },
    }),
  ]);

  return ok({ success: true, cleanerId: cleaner.id, cleanerName: cleaner.name });
});
