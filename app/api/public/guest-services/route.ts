import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { withErrors, readJson, fail, ok } from '@/lib/core/http';
import { pickupRequestSchema, guestGuide, arrivalDateAllowed } from '@/lib/guest-guide';
import { slugCandidates } from '@/lib/property-display';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export const POST = withErrors('guest-services/create', async req => {
  const limit = rateLimit(`guest-service:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!limit.ok) throw fail(429, '잠시 후 다시 시도해 주세요. / Please try again later.');
  const parsed = pickupRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) throw fail(400, '입력 항목과 개인정보 동의를 확인해 주세요. / Please check the form and consent.');
  const { id, slug, guestName, email, phone, arrivalDate, arrivalTime, flightNumber, passengers, luggage, message, language } = parsed.data;
  const input = { guestName, email, phone, arrivalDate, arrivalTime, flightNumber, passengers, luggage, message, language };
  const guide = guestGuide(slug);
  if (!guide) throw fail(404, '안내 페이지를 찾을 수 없습니다. / Guide not found.');
  const requestHash = createHash('sha256').update(JSON.stringify({ ...input, slug: guide.slug })).digest('hex');
  const receipt = (existing: {requestHash: string}) => {
    if (existing.requestHash !== requestHash) throw fail(409, '이미 접수된 요청입니다. 새 요청으로 작성해 주세요. / This request has already been submitted.');
    return ok({ id, received: true });
  };
  const existing = await prisma.guestServiceRequest.findUnique({ where: { id }, select: { requestHash: true } });
  if (existing) return receipt(existing);
  if (!arrivalDateAllowed(input.arrivalDate)) throw fail(400, '오늘부터 1년 이내 도착일을 선택해 주세요. / Choose an arrival within the next year.');
  const property = await prisma.property.findFirst({ where: { slug: { in: slugCandidates(guide.slug) }, status: 'active' }, select: { id: true } });
  if (!property) throw fail(409, '현재 신청을 접수할 수 없습니다. 예약하신 채널로 문의해 주세요. / Please contact your host through your booking channel.');
  try {
    await prisma.guestServiceRequest.create({ data: { id, propertyId: property.id, ...input, kind: 'airport_pickup', status: 'requested', quotedPrice: guide.pickupPrice, requestHash } });
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002') {
      const duplicate = await prisma.guestServiceRequest.findUnique({ where: { id }, select: { requestHash: true } });
      if (duplicate) return receipt(duplicate);
    }
    throw e;
  }
  return ok({ id, received: true }, 201);
});
