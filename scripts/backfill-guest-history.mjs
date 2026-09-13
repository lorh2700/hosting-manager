// Production TS runner for the bounded customer-history backfill (no test stubs).
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
registerHooks({ resolve(specifier, context, nextResolve) {
  let base;
  if (specifier.startsWith('@/')) base = resolvePath(specifier.slice(2));
  else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  if (base) for (const file of [base, base + '.ts', base + '.js']) if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { prisma } = await import('../lib/prisma.ts');
const { normalizeIdentity, recordBooking, recordEvent } = await import('../lib/guest-history.ts');
try {
  let total = 0;
  for (const stage of ['guest', 'event', 'booking']) {
    let cursor;
    while (true) {
      const rows = await prisma[stage].findMany({ take: 25, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), ...(stage === 'event' ? { where: { type: 'reservation', channelId: 'beds24' } } : {}) });
      for (const row of rows) {
        if (stage === 'guest') await prisma.guest.update({ where: { id: row.id }, data: normalizeIdentity(row) });
        else if (stage === 'booking') await recordBooking(row);
        else {
          const existing = await prisma.guestReservation.findUnique({ where: { key: `${row.propertyId}:beds24:${row.originalUid}` } });
          if (!existing) await recordEvent(row);
        }
      }
      total += rows.length;
      console.log(JSON.stringify({ stage, processed: total }));
      if (rows.length < 25) break;
      cursor = rows.at(-1).id;
    }
  }
  console.log(JSON.stringify({ reservations: await prisma.guestReservation.count(), review: await prisma.guestReservation.count({ where: { matchStatus: 'review' } }), customers: await prisma.guest.count() }));
} finally { await prisma.$disconnect(); }
