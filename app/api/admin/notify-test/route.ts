import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser } from '@/lib/auth';
import { notifyCleaningAssigned, TEMPLATES, getNotifier } from '@/lib/notify';

/**
 * POST /api/admin/notify-test
 * Body: { cleanerId?: string, phone?: string, propertyName?: string, date?: string }
 *
 * Fires a single test alimtalk using the CLEANING_ASSIGNED template so we
 * can verify Solapi credentials, template approval, and recipient delivery
 * end-to-end without going through the real assignment flow.
 *
 * Resolution:
 *   - cleanerId given → look up that cleaner
 *   - phone given     → synthesize a fake recipient (uses session user name)
 *   - neither given   → first cleaner with phone+publicToken in the DB
 */
export async function POST(req: Request) {
  const auth = await getSessionWithUser(req);
  if (!auth || !auth.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    cleanerId?: string;
    phone?: string;
    propertyName?: string;
    date?: string;
  };

  let cleanerName: string;
  let cleanerPhone: string | null;
  let cleanerToken: string | null;

  if (body.cleanerId) {
    const c = await prisma.cleaner.findUnique({
      where: { id: body.cleanerId },
      select: { name: true, phone: true, publicToken: true },
    });
    if (!c) return NextResponse.json({ error: 'cleaner not found' }, { status: 404 });
    cleanerName = c.name;
    cleanerPhone = c.phone;
    cleanerToken = c.publicToken;
  } else if (body.phone) {
    cleanerName = auth.user.displayName ?? '테스트';
    cleanerPhone = body.phone;
    cleanerToken = 'test-token';
  } else {
    const c = await prisma.cleaner.findFirst({
      where: { phone: { not: null }, publicToken: { not: null } },
      select: { name: true, phone: true, publicToken: true },
    });
    if (!c) {
      return NextResponse.json({
        error: 'no cleaner with phone+publicToken found; pass cleanerId or phone',
      }, { status: 400 });
    }
    cleanerName = c.name;
    cleanerPhone = c.phone;
    cleanerToken = c.publicToken;
  }

  const provider = getNotifier();
  const result = await notifyCleaningAssigned({
    cleanerPhone,
    cleanerName,
    cleanerToken,
    items: [{
      propertyName: body.propertyName ?? '안온재',
      date: body.date ?? new Date().toISOString().slice(0, 10),
      checkoutTime: '11:00',
    }],
  });

  return NextResponse.json({
    provider: provider.name,
    templateId: TEMPLATES.CLEANING_ASSIGNED || '(unset)',
    sentTo: cleanerPhone,
    cleanerName,
    result,
  });
}
