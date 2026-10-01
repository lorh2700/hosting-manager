import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireManage } from '@/lib/core/http';
import { conversationReplyTarget } from '@/lib/message-presentation';

export const GET = withAuth<{ id: string }>('conversations/reply-target', async (_req, { auth, params }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { propertyId: true, source: true, channelId: true, originalUid: true },
  });
  if (event) {
    requireManage(auth, event.propertyId);
    return ok(conversationReplyTarget(event.source, event.channelId, event.originalUid));
  }
  const booking = await prisma.booking.findUnique({ where: { id: params.id }, select: { propertyId: true, source: true } });
  if (!booking) throw fail(404, '예약 대화를 찾을 수 없습니다.');
  requireManage(auth, booking.propertyId);
  // The send endpoint saves Booking records as memos; do not imply an OTA send.
  return ok(conversationReplyTarget(booking.source));
});
