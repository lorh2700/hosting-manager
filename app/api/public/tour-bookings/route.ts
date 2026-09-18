import { todayKst } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { notifyTourHostOfBooking, notifyTourGuestOfBooking } from '@/lib/notify';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, created, fail, readJson, str } from '@/lib/core/http';

export const POST = withErrors('public/tour-bookings', async (req) => {
  // Best-effort rate limit: 10 bookings / IP / 10 min
  const rl = rateLimit(`tour-booking:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw fail(429, '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');

  const body = await readJson(req);
  const tourId = str(body, 'tourId');
  const requestedDate = str(body, 'requestedDate') ?? '';
  const requestedTime = str(body, 'requestedTime') ?? '';
  const requestedAt = new Date(`${requestedDate}T${requestedTime}:00+09:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(requestedTime) || !Number.isFinite(requestedAt.getTime()) || todayKst(requestedAt) !== requestedDate || requestedAt.getTime() <= Date.now()) throw fail(400, '희망 날짜와 시간을 미래 일정으로 선택해주세요.');
  const name = str(body, 'name');
  if (!tourId || !name?.trim()) throw fail(400, '이름과 투어는 필수입니다.');
  const trimmedPhone = (str(body, 'phone') ?? '').trim();
  if (!/^[+\d][\d\s()-]{6,24}$/.test(trimmedPhone)) throw fail(400, '메시지를 받을 수 있는 연락처를 입력해주세요.');
  const durationOptionId = str(body, 'durationOptionId');
  const tickets = body.tickets;          // [{ tierId, count }] — for tier-based tours
  const language = str(body, 'language');
  const meetingChoice = str(body, 'meetingChoice');
  const meetingDetail = str(body, 'meetingDetail');

  const result = await prisma.$transaction(async (tx) => {
    const tour = await tx.tour.findUnique({
      where: { id: tourId },
      include: { operator: true, durationOptions: true, ticketTiers: true, owner: { select: { id: true, displayName: true, email: true, phone: true } } },
    });
    if (!tour || !tour.isActive) throw fail(404, '문의 가능한 투어를 찾을 수 없습니다.');

    // Resolve chosen course option (if any) and snapshot price/duration.
    let durationOption = null as null | (typeof tour.durationOptions)[number];
    if (durationOptionId) {
      durationOption = tour.durationOptions.find(o => o.id === durationOptionId) ?? null;
      if (!durationOption) return { ok: false as const, error:'선택한 코스를 찾을 수 없습니다.', status: 400 } as const;
    } else if (tour.durationOptions.length > 0) {
      return { ok: false as const, error:'코스를 선택해주세요.', status: 400 } as const;
    }

    // Tier-based ticketing when the tour has ticket tiers; legacy `guests` otherwise.
    const ticketSnapshot: Array<{ tierId: string; label: string; count: number; unitPrice: number }> = [];
    let guestCount: number;
    let totalPrice: number | null;

    if (tour.ticketTiers.length > 0) {
      if (!Array.isArray(tickets) || tickets.length === 0) return { ok: false as const, error:'티켓 종류를 선택해주세요.', status: 400 } as const;
      const tierMap = new Map(tour.ticketTiers.map(t => [t.id, t]));
      let sumCount = 0;
      let sumPrice = 0;
      for (const t of tickets as Array<{ tierId?: string; count?: number }>) {
        const tier = t.tierId ? tierMap.get(t.tierId) : null;
        const count = Number(t.count);
        if (!Number.isInteger(count) || count < 1 || count > 50) throw fail(400, '티켓 인원을 확인해주세요.');
        if (!tier || count === 0) continue;
        const unit = Number(tier.price);
        ticketSnapshot.push({ tierId: tier.id, label: tier.label, count, unitPrice: unit });
        sumCount += count;
        sumPrice += unit * count;
      }
      if (sumCount === 0) return { ok: false as const, error:'인원을 1명 이상 선택해주세요.', status: 400 } as const;
      guestCount = sumCount;
      totalPrice = sumPrice;
    } else {
      guestCount = Number(body.guests);
      const unitPrice = durationOption ? Number(durationOption.price) : tour.basePrice ? Number(tour.basePrice) : null;
      totalPrice = unitPrice !== null ? unitPrice * guestCount : null;
    }

    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > (tour.maxGroupSize ?? 50)) throw fail(400, '투어 최대 인원을 확인해주세요.');

    const unitPriceForLegacy = durationOption ? Number(durationOption.price) : tour.basePrice ? Number(tour.basePrice) : null;
    const durationMin = durationOption?.durationMin ?? tour.durationMin ?? null;

    const booking = await tx.tourBooking.create({
      data: {
        tourId: tour.id,
        requestedDate,
        requestedTime,
        durationOptionId: durationOption?.id ?? null,
        durationMin,
        unitPrice: ticketSnapshot.length > 0 ? null : unitPriceForLegacy,
        tickets: ticketSnapshot.length > 0 ? ticketSnapshot : undefined,
        language: language || null,
        meetingChoice: meetingChoice || null,
        meetingDetail: meetingDetail && meetingDetail.trim() ? meetingDetail.trim() : null,
        name,
        phone: trimmedPhone,
        email: str(body, 'email') || null,
        guests: guestCount,
        totalPrice,
        message: str(body, 'message') || null,
        status: 'pending',
        source: 'inquiry',
      },
    });

    return { ok: true as const, booking, tour };
  });

  if (!result.ok) throw fail(result.status, result.error);

  const commonNotifyOpts = {
    inquiry: true,
    tourTitle: result.tour.title,
    guestName: name,
    guests: result.booking.guests,
    date: requestedDate,
    startTime: requestedTime,
    durationMin: result.booking.durationMin,
    totalPrice: result.booking.totalPrice ? Number(result.booking.totalPrice) : null,
    meetingPoint: result.tour.meetingPoint,
    bookingId: result.booking.id,
  };
  notifyTourHostOfBooking({
    ...commonNotifyOpts, guestPhone: trimmedPhone || null,
    hostPhone: result.tour.owner.phone, hostName: result.tour.owner.displayName ?? result.tour.owner.email,
  }).catch(err => console.error('[public/tour-bookings] host notify failed:', err));
  notifyTourGuestOfBooking({ ...commonNotifyOpts, guestPhone: trimmedPhone || null })
    .catch(err => console.error('[public/tour-bookings] guest notify failed:', err));

  return created({ success: true, bookingId: result.booking.id });
});
