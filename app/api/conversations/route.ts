import { prisma } from '@/lib/prisma';
import { withAuth, ok, query } from '@/lib/core/http';

/** 예약(이벤트) 단위 대화 목록 — 마지막 메시지와 읽지 않은 수. */
export const GET = withAuth('conversations', async (req, { auth }) => {
  const limit = Math.min(Math.max(Number(query(req, 'limit')) || 20, 1), 100);
  const offset = Math.max(0, Number(query(req, 'offset')) || 0);

  const properties = await prisma.property.findMany({
    where: auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } },
    select: { id: true, name: true },
  });
  const propIds = properties.map(p => p.id);
  if (propIds.length === 0) return ok({ conversations: [], hasMore: false });
  const propsMap = Object.fromEntries(properties.map(p => [p.id, p.name]));

  const groups = await prisma.message.groupBy({
    by: ['eventId'],
    where: { propertyId: { in: propIds }, eventId: { not: null } },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: limit + 1,
    skip: offset,
  });

  const hasMore = groups.length > limit;
  const pageGroups = hasMore ? groups.slice(0, limit) : groups;
  const eventIds = pageGroups.map(g => g.eventId).filter((id): id is string => !!id);
  if (eventIds.length === 0) return ok({ conversations: [], hasMore: false });

  const [messages, events, bookings] = await Promise.all([
    prisma.message.findMany({
      where: { eventId: { in: eventIds } },
      select: { id: true, eventId: true, propertyId: true, text: true, sender: true, createdAt: true, read: true, guestName: true },
    }),
    prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, propertyId: true, title: true, startDate: true, endDate: true, description: true },
    }),
    prisma.booking.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, propertyId: true, name: true, checkIn: true, checkOut: true, email: true, guests: true, message: true },
    }),
  ]);

  const msgsByEvent: Record<string, typeof messages> = {};
  for (const m of messages) {
    if (!m.eventId) continue;
    (msgsByEvent[m.eventId] ??= []).push(m);
  }
  const eventMap = Object.fromEntries(events.map(e => [e.id, e]));
  const bookingMap = Object.fromEntries(bookings.map(b => [b.id, b]));

  const conversations = pageGroups
    .filter(g => g.eventId)
    .map(g => {
      const eventId = g.eventId!;
      const msgs = (msgsByEvent[eventId] || []).sort((a, b) => a.createdAt.toString().localeCompare(b.createdAt.toString()));
      const last = msgs[msgs.length - 1];
      const unread = msgs.filter(m => m.sender === 'guest' && !m.read).length;
      const evt = eventMap[eventId];
      const bk = bookingMap[eventId];

      if (evt) {
        return {
          eventId,
          propertyId: evt.propertyId,
          guestName: (evt.title || '').replace(/ 예약$/, ''),
          propertyName: propsMap[evt.propertyId] || evt.propertyId,
          lastMessage: last?.text || '',
          lastMessageAt: last?.createdAt.toString() || '',
          unread,
          eventDescription: evt.description || undefined,
          checkIn: evt.startDate,
          checkOut: evt.endDate,
        };
      }
      if (bk) {
        return {
          eventId,
          propertyId: bk.propertyId,
          guestName: bk.name || '게스트',
          propertyName: propsMap[bk.propertyId] || bk.propertyId,
          lastMessage: last?.text || '',
          lastMessageAt: last?.createdAt.toString() || '',
          unread,
          eventDescription: bk.message || undefined,
          checkIn: bk.checkIn,
          checkOut: bk.checkOut,
        };
      }
      return {
        eventId,
        propertyId: last?.propertyId || '',
        guestName: last?.guestName || '게스트',
        propertyName: last?.propertyId ? (propsMap[last.propertyId] || '') : '',
        lastMessage: last?.text || '',
        lastMessageAt: last?.createdAt.toString() || '',
        unread,
      };
    });

  return ok({ conversations, hasMore });
});
