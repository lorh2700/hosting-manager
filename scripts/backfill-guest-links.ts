import { prisma } from '../lib/prisma';
import { beds24Get } from '../lib/beds24';
import { backfillGuestLinks } from '../lib/guest-link-backfill';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('INVALID_ARGUMENTS');
  const report = await backfillGuestLinks({ db: prisma, secret: process.env.JWT_SECRET || '',
    origin: process.env.NEXT_PUBLIC_APP_URL, apply: args.includes('--apply'),
    listProperties: () => prisma.property.findMany({ where: { status: 'active' }, select: { id: true, status: true, beds24PropId: true, beds24RoomId: true } }),
    listEvents: (propertyId, departureFrom) => prisma.event.findMany({
      where: { propertyId, channelId: 'beds24', type: 'reservation', endDate: { gte: departureFrom } },
      select: { id: true, propertyId: true, originalUid: true, type: true, channelId: true, source: true, startDate: true, endDate: true, title: true } }),
    readBookings: async params => {
      const warn = console.warn, error = console.error;
      try {
        console.warn = () => undefined;
        console.error = () => undefined;
        return await beds24Get('/bookings', params, { timeoutMs: 15_000 });
      } finally { console.warn = warn; console.error = error; }
    },
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.complete) process.exitCode = 2;
}

main().catch(() => {
  console.error('GUEST_LINK_BACKFILL_FAILED: check configuration, database migration and provider availability.');
  process.exitCode = 1;
}).finally(async () => {
  try { await prisma.$disconnect(); }
  catch { console.error('GUEST_LINK_BACKFILL_DISCONNECT_FAILED'); process.exitCode = 1; }
});
