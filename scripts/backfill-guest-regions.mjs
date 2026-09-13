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
const { beds24Get } = await import('../lib/beds24.ts');
const { bedsResidenceCountry } = await import('../lib/guest-region.ts');
let saved = 0, supplied = 0;
try {
 const properties = await prisma.property.findMany({ where: { beds24PropId: { not: null } }, select: { id: true, beds24PropId: true } });
 for (const property of properties) {
  for (let page = 1; page <= 100; page++) {
   const result = await beds24Get('/bookings', { propertyId: String(property.beds24PropId), page: String(page) }, { timeoutMs: 20000 });
   if (result.success === false || !Array.isArray(result.data)) throw new Error('Country import failed: invalid Beds24 response');
   for (const booking of result.data) {
    const residenceCountry = bedsResidenceCountry(booking);
    if (!booking.id || !residenceCountry) continue;
    supplied++;
    const update = await prisma.guestReservation.updateMany({ where: { key: `${property.id}:beds24:${booking.id}` }, data: { residenceCountry } });
    saved += update.count;
   }
   if (!result.pages?.nextPageExists) break;
   if (page === 100 || result.data.length === 0) throw new Error('Country import pagination incomplete');
  }
  console.log(JSON.stringify({ propertiesProcessed: properties.indexOf(property) + 1, supplied, saved }));
 }
 console.log(JSON.stringify({ completed: true, saved }));
} finally { await prisma.$disconnect(); }
