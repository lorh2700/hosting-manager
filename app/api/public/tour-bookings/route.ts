import { prisma } from '@/lib/prisma';
import { notifyTourHostOfBooking, notifyTourGuestOfBooking } from '@/lib/notify';
import { rateLimit, clientIp } from '@/lib/rateLimit';
import { withErrors, created, fail, readJson, str } from '@/lib/core/http';

export const POST = withErrors('public/tour-bookings', async (req) => {
  // Best-effort rate limit: 10 bookings / IP / 10 min
  const rl = rateLimit(`tour-booking:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.ok) throw fail(429, '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');

  const body = await readJson(req);
  const scheduleId = str(body, 'scheduleId');
  const name = str(body, 'name');
  if (!scheduleId || !name) throw fail(400, '이름, 슬롯은 필수입니다.');
  const trimmedPhone = (str(body, 'phone') ?? '').trim();
  const durationOptionId = str(body, 'durationOptionId');
  const tickets = body.tickets;          // [{ tierId, count }] — for tier-based tours
  const language = str(body, 'language');
  const meetingChoice = str(body, 'meetingChoice');
  const meetingDetail = str(body, 'meetingDetail');

  const result = await prisma.$transaction(async (tx) => {
    const schedule = await tx.tourSchedule.findUnique({
      where: { id: scheduleId },
      include: { tour: { include: { operator: true, durationOptions: true, ticketTiers: true, owner: { select: { id: true, displayName: true, email: true, phone: true } } } } },
    });
    if (!schedule) return { ok: false as const, error:'슬롯을 찾을 수 없습니다.', status: 404 } as const;
    if (schedule.status !== 'open') return { ok: false as const, error:'마감된 슬롯입니다.', status: 410 } as const;
    if (!schedule.tour.isActive) return { ok: false as const, error:'판매 중지된 투어입니다.', status: 410 } as const;

    // Resolve chosen course option (if any) and snapshot price/duration.
    let durationOption = null as null | (typeof schedule.tour.durationOptions)[number];
    if (durationOptionId) {
      durationOption = schedule.tour.durationOptions.find(o => o.id === durationOptionId) ?? null;
      if (!durationOption) return { ok: false as const, error:'선택한 코스를 찾을 수 없습니다.', status: 400 } as const;
    } else if (schedule.tour.durationOptions.length > 0) {
      return { ok: false as const, error:'코스를 선택해주세요.', status: 400 } as const;
    }

    // Tier-based ticketing when the tour has ticket tiers; legacy `guests` otherwise.
    const ticketSnapshot: Array<{ tierId: string; label: string; count: number; unitPrice: number }> = [];
    let guestCount: number;
    let totalPrice: number | null;

    if (schedule.tour.ticketTiers.length > 0) {
      if (!Array.isArray(tickets) || tickets.length === 0) return { ok: false as const, error:'티켓 종류를 선택해주세요.', status: 400 } as const;
      const tierMap = new Map(schedule.tour.ticketTiers.map(t => [t.id, t]));
      let sumCount = 0;
      let sumPrice = 0;
      for (const t of tickets as Array<{ tierId?: string; count?: number }>) {
        const tier = t.tierId ? tierMap.get(t.tierId) : null;
        const count = Math.max(0, Math.min(50, Number(t.count) || 0));
        if (!tier || count === 0) continue;
        const unit = Number(tier.price);
        ticketSnapshot.push({ tierId: tier.id, label: tier.label, count, unitPrice: unit });
        sumCount += count;
        sumPrice += unit * count;
      }
      if (sumCount === 0) return { ok: false as const, error:'인원을 1명 이상 선택해주세요.', status: 400 } as const;
      guestCount = Math.min(50, sumCount);
      totalPrice = sumPrice;
    } else {
      guestCount = Math.max(1, Math.min(50, Number(body.guests) || 1));
      const unitPrice = durationOption ? Number(durationOption.price) : schedule.tour.basePrice ? Number(schedule.tour.basePrice) : null;
      totalPrice = unitPrice !== null ? unitPrice * guestCount : null;
    }

    const remaining = schedule.capacity - schedule.bookedCount;
    if (remaining < guestCount) return { ok: false as const, error:`남은 자리는 ${remaining}명입니다.`, status: 409 } as const;

    const updated = await tx.tourSchedule.updateMany({
      where: { id: scheduleId, status: 'open', bookedCount: { lte: schedule.capacity - guestCount } },
      data: { bookedCount: { increment: guestCount } },
    });
    if (updated.count === 0) return { ok: false as const, error:'동시 예약이 발생했습니다. 다시 시도해주세요.', status: 409 } as const;

    const unitPriceForLegacy = durationOption ? Number(durationOption.price) : schedule.tour.basePrice ? Number(schedule.tour.basePrice) : null;
    const durationMin = durationOption?.durationMin ?? schedule.tour.durationMin ?? null;

    const booking = await tx.tourBooking.create({
      data: {
        tourId: schedule.tourId,
        scheduleId: schedule.id,
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
        source: 'direct',
      },
    });

    return { ok: true as const, booking, schedule, tour: schedule.tour };
  });

  if (!result.ok) throw fail(result.status, result.error);

  const commonNotifyOpts = {
    tourTitle: result.tour.title,
    guestName: name,
    guests: result.booking.guests,
    date: result.schedule.date,
    startTime: result.schedule.startTime,
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
