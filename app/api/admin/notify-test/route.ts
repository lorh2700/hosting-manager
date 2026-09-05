import { prisma } from '@/lib/prisma';
import { notifyCleaningAssigned, TEMPLATES, getNotifier } from '@/lib/notify';
import { withAuth, ok, fail, str } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';

/**
 * POST /api/admin/notify-test
 * Body: { cleanerId?: string, phone?: string, propertyName?: string, date?: string }
 *
 * Fires a single test alimtalk using the CLEANING_ASSIGNED template so we
 * can verify Solapi credentials, template approval, and recipient delivery
 * end-to-end without going through the real assignment flow.
 */
export const POST = withAuth('admin/notify-test', async (req, { auth }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cleanerId = str(body, 'cleanerId');
  const phone = str(body, 'phone');

  let cleanerName: string;
  let cleanerPhone: string | null;
  let cleanerToken: string | null;

  if (cleanerId) {
    const c = await prisma.cleaner.findUnique({ where: { id: cleanerId }, select: { name: true, phone: true, publicToken: true } });
    if (!c) throw fail(404, 'cleaner not found');
    cleanerName = c.name; cleanerPhone = c.phone; cleanerToken = c.publicToken;
  } else if (phone) {
    cleanerName = auth.user.displayName ?? '테스트';
    cleanerPhone = phone;
    cleanerToken = 'test-token';
  } else {
    const c = await prisma.cleaner.findFirst({
      where: { phone: { not: null }, publicToken: { not: null } },
      select: { name: true, phone: true, publicToken: true },
    });
    if (!c) throw fail(400, 'no cleaner with phone+publicToken found; pass cleanerId or phone');
    cleanerName = c.name; cleanerPhone = c.phone; cleanerToken = c.publicToken;
  }

  const provider = getNotifier();
  const result = await notifyCleaningAssigned({
    cleanerPhone,
    cleanerName,
    cleanerToken,
    items: [{ propertyName: str(body, 'propertyName') ?? '안온재', date: str(body, 'date') ?? todayKst(), checkoutTime: '11:00' }],
  });

  return ok({ provider: provider.name, templateId: TEMPLATES.CLEANING_ASSIGNED || '(unset)', sentTo: cleanerPhone, cleanerName, result });
}, { admin: true });
