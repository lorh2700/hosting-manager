import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, readJson, str, query, DATE_RE } from '@/lib/core/http';
import { getCheckoutStatus, recordCheckoutSignal, notifyCheckoutRecipients } from '@/lib/checkout';
import { todayKst } from '@/lib/dates';

/**
 * 객실 패드 셀프 체크아웃.
 *  GET  ?propertyKey=anon[&date=YYYY-MM-DD] → 그 날짜의 체크아웃 상태 (패드가 버튼 표시 여부를 정할 때)
 *  POST { propertyKey, bookingId?, date? }   → guest_pad 신호 기록 + 청소담당자·호스트 알림 (하루 한 번)
 * Auth: x-api-key (env WELCOMEPAD_API_KEY) — /checkins, /cleanings/done 과 같은 비밀키.
 */
function requirePadKey(req: Request): void {
  const expected = process.env.WELCOMEPAD_API_KEY;
  if (!expected) throw fail(500, 'WELCOMEPAD_API_KEY not configured');
  if (req.headers.get('x-api-key') !== expected) throw fail(401, 'Unauthorized');
}

async function resolveProperty(propertyKey: string) {
  const property = await prisma.property.findUnique({ where: { welcomepadKey: propertyKey }, select: { id: true, name: true } });
  if (!property) throw fail(404, `propertyKey '${propertyKey}' not found`);
  return property;
}

function pickDate(raw: string | null | undefined): string {
  if (raw && DATE_RE.test(raw)) return raw;
  return todayKst();
}

export const GET = withErrors('welcomepad/checkout', async (req) => {
  requirePadKey(req);
  const propertyKey = query(req, 'propertyKey');
  if (!propertyKey) throw fail(400, 'propertyKey is required');
  const property = await resolveProperty(propertyKey);
  const date = pickDate(query(req, 'date'));
  const status = await getCheckoutStatus(property.id, date);
  return ok({ date, propertyKey, propertyName: property.name, ...status });
});

export const POST = withErrors('welcomepad/checkout', async (req, { log }) => {
  requirePadKey(req);
  const body = await readJson(req);
  const propertyKey = str(body, 'propertyKey', { required: true })!.trim();
  const property = await resolveProperty(propertyKey);
  const date = pickDate(str(body, 'date'));
  const bookingId = str(body, 'bookingId') || null;

  // 예약 연결: 패드가 준 Beds24 bookingId 우선, 없으면 그 날짜에 체크아웃하는 예약.
  let eventId: string | null = null;
  if (bookingId) {
    const ev = await prisma.event.findFirst({ where: { propertyId: property.id, originalUid: bookingId, type: 'reservation' }, select: { id: true } });
    eventId = ev?.id ?? null;
  }
  if (!eventId) {
    const ev = await prisma.event.findFirst({ where: { propertyId: property.id, type: 'reservation', endDate: date }, select: { id: true }, orderBy: { createdAt: 'desc' } });
    eventId = ev?.id ?? null;
  }

  const rec = await recordCheckoutSignal({ propertyId: property.id, date, kind: 'guest_pad', eventId, note: 'pad' });
  let notified = 0;
  if (!rec.duplicate && rec.newlyConfirmed) {
    const result = await notifyCheckoutRecipients({ propertyId: property.id, date, kind: 'guest_pad', at: rec.signal.at });
    notified = result.notified;
    log(`guest self-checkout ${property.name} ${date}: notified ${notified}`);
  }

  return ok({
    ok: true,
    duplicate: rec.duplicate,
    confirmedAt: rec.signal.at.toISOString(),
    notified,
  }, rec.duplicate ? 200 : 201);
});
