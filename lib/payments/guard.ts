import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/http';
export async function requireUnpaidBooking(bookingId: string) {
  const payment = await prisma.checkoutOrder.findFirst({ where: { bookingId, status: { notIn: ['expired', 'refunded'] } } });
  if (payment) throw fail(409, '온라인 결제 예약은 결제 관리에서 환불·취소해주세요. /admin/payments');
}
export async function requireUnpaidBedsBooking(beds24Id: string) {
  const payment = await prisma.checkoutOrder.findFirst({ where: { beds24Id, status: { notIn: ['expired', 'refunded'] } } });
  if (payment) throw fail(409, '결제 관리에서 해당 주문을 처리해주세요. /admin/payments');
}
