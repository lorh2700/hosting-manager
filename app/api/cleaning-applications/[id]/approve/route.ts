import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';

/**
 * Approve a cleaning application.
 *
 * Atomically:
 *   1. Resolves the applicant (User.id) → Cleaner.id
 *   2. Marks the application as approved
 *   3. Assigns the cleaner to the cleaning + closes it (isOpen=false)
 *   4. Auto-rejects every other pending application for the same cleaning
 *
 * Doing this server-side avoids the FK-violation bug that happens when
 * the client mistakenly passes User.id directly as Cleaning.cleanerId.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const application = await prisma.cleaningApplication.findUnique({
      where: { id },
      select: { id: true, applicantId: true, cleaningId: true, propertyId: true, status: true },
    });
    if (!application) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Owner-or-admin check (host can approve only their property's apps)
    if (!auth.isAdmin && !(auth.propertyIds ?? []).includes(application.propertyId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (application.status !== 'pending') {
      return NextResponse.json(
        { error: `이미 처리된 신청입니다. (현재 상태: ${application.status})` },
        { status: 409 },
      );
    }

    // Resolve User.id → Cleaner.id
    const cleaner = await prisma.cleaner.findUnique({
      where: { userId: application.applicantId },
      select: { id: true, name: true },
    });
    if (!cleaner) {
      return NextResponse.json(
        { error: '신청자의 청소 담당자 프로필이 없습니다. 먼저 청소 담당자로 등록해주세요.' },
        { status: 422 },
      );
    }

    const now = new Date();

    await prisma.$transaction([
      prisma.cleaningApplication.update({
        where: { id: application.id },
        data: {
          status: 'approved',
          processedBy: auth.session.userId,
          processedAt: now,
        },
      }),
      prisma.cleaning.update({
        where: { id: application.cleaningId },
        data: {
          cleanerId: cleaner.id,
          isOpen: false,
          assignmentType: 'applied',
        },
      }),
      prisma.cleaningApplication.updateMany({
        where: {
          cleaningId: application.cleaningId,
          id: { not: application.id },
          status: 'pending',
        },
        data: {
          status: 'rejected',
          rejectedReason: '다른 담당자가 배정되었습니다',
          processedBy: auth.session.userId,
          processedAt: now,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      cleanerId: cleaner.id,
      cleanerName: cleaner.name,
    });
  } catch (e) {
    console.error('[cleaning-applications/:id/approve] POST error:', e);
    return NextResponse.json({ error: '승인 처리에 실패했습니다.' }, { status: 500 });
  }
}
