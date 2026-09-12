import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, isCronRequest } from '@/lib/core/http';
import { reconcileCheckout } from '@/lib/payments/checkout';
export const maxDuration = 60;
export const POST = withErrors('cron/payments', async req => {
  if (!isCronRequest(req)) throw fail(401, 'Unauthorized');
  const rows = await prisma.checkoutOrder.findMany({ where: { status: { in: ['quoted', 'holding', 'awaiting_payment', 'approving', 'fulfilling', 'refund_pending'] },
    updatedAt: { lt: new Date(Date.now() - 60_000) },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
  }, orderBy: { updatedAt: 'asc' }, take: 1 });
  const results = [];
  for (const row of rows) {
    try { results.push({ id: row.id, status: (await reconcileCheckout(row.id)).status }); }
    catch { results.push({ id: row.id, status: 'retry_pending' }); }
  }
  return ok({ results });
});
