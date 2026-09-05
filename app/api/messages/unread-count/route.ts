import { prisma } from '@/lib/prisma';
import { withAuth, ok, visibleScope } from '@/lib/core/http';

// 읽지 않은 게스트 메시지 수 — 볼 수 있는 숙소 범위로 제한한다.
export const GET = withAuth('messages/unread-count', async (_req, { auth }) => {
  const visible = await visibleScope(auth);
  if (visible !== null && visible.length === 0) return ok({ count: 0 });
  const count = await prisma.message.count({
    where: { sender: 'guest', read: false, ...(visible ? { propertyId: { in: visible } } : {}) },
  });
  return ok({ count });
});
