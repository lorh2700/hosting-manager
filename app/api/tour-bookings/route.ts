import { prisma } from '@/lib/prisma';
import { authorizeTourBooking, authorizeTourSchedule } from '@/lib/auth';
import { notifyTourHostOfBooking, notifyTourGuestOfBooking } from '@/lib/notify';
import { withAuth, ok, created, fail, MESSAGES, readJson, str, query } from '@/lib/core/http';

export const GET = withAuth('tour-bookings', async (req, { auth }) => {
  const tourId = query(req, 'tourId');
  const status = query(req, 'status');
  const bookings = await prisma.tourBooking.findMany({
    where: {
      ...(auth.isAdmin ? {} : { tour: { ownerId: auth.session.userId } }),
      ...(tourId ? { tourId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      tour: { select: { id: true, title: true, operator: { select: { id: true, name: true, contactPhone: true, email: true } } } },
      schedule: { select: { date: true, startTime: true } },
      durationOption: { select: { id: true, label: true, durationMin: true, price: true } },
    },
  });

  return ok(bookings.map(b => ({
    id: b.id, tourId: b.tourId, scheduleId: b.scheduleId,
    name: b.name, phone: b.phone, email: b.email, guests: b.guests, durationMin: b.durationMin,
    unitPrice: b.unitPrice ? Number(b.unitPrice) : null,
    totalPrice: b.totalPrice ? Number(b.totalPrice) : null,
    status: b.status, forwardedAt: b.forwardedAt, message: b.message, source: b.source, createdAt: b.createdAt,
    tour: { id: b.tour.id, title: b.tour.title, operator: b.tour.operator },
    schedule: b.schedule,
    durationOption: b.durationOption
      ? { id: b.durationOption.id, label: b.durationOption.label, durationMin: b.durationOption.durationMin, price: Number(b.durationOption.price) }
      : null,
  })));
});

export const POST = withAuth('tour-bookings', async (req, { auth }) => {
  const body = await readJson(req);
  const scheduleId = str(body, 'scheduleId');
  const name = str(body, 'name');
  const guestCount = Math.max(1, Number(body.guests) || 0);
  if (!scheduleId || !name || !body.guests) throw fail(400, '이름, 슬롯, 인원은 필수입니다.');

  // Verify the admin owns the tour behind this schedule.
  if (!(await authorizeTourSchedule(scheduleId, auth.session.userId, { isAdmin: auth.isAdmin }))) throw fail(403, MESSAGES.forbidden);

  const trimmedPhone = (str(body, 'phone') ?? '').trim();
  const durationOptionId = str(body, 'durationOptionId');

  const result = await prisma.$transaction(async (tx) => {
    const schedule = await tx.tourSchedule.findUnique({
      where: { id: scheduleId },
      include: { tour: { include: { operator: true, durationOptions: true, owner: { select: { id: true, displayName: true, email: true, phone: true } } } } },
    });
    if (!schedule) return { ok: false as const, error:'슬롯을 찾을 수 없습니다.', status: 404 } as const;
    if (schedule.capacity - schedule.bookedCount < guestCount) {
      return { ok: false as const, error:`남은 자리는 ${schedule.capacity - schedule.bookedCount}명입니다.`, status: 409 } as const;
    }

    const durationOption = durationOptionId ? (schedule.tour.durationOptions.find(o => o.id === durationOptionId) ?? null) : null;

    const updated = await tx.tourSchedule.updateMany({
      where: { id: scheduleId, bookedCount: { lte: schedule.capacity - guestCount } },
      data: { bookedCount: { increment: guestCount } },
    });
    if (updated.count === 0) return { ok: false as const, error:'동시 예약이 발생했습니다. 다시 시도해주세요.', status: 409 } as const;

    const unitPrice = durationOption ? Number(durationOption.price) : schedule.tour.basePrice ? Number(schedule.tour.basePrice) : null;
    const durationMin = durationOption?.durationMin ?? schedule.tour.durationMin ?? null;
    const totalPrice = unitPrice !== null ? unitPrice * guestCount : null;

    const booking = await tx.tourBooking.create({
      data: {
        tourId: schedule.tourId,
        scheduleId: schedule.id,
        durationOptionId: durationOption?.id ?? null,
        durationMin,
        unitPrice,
        bookingId: str(body, 'bookingId') || null,
        name,
        phone: trimmedPhone,
        email: str(body, 'email') || null,
        guests: guestCount,
        totalPrice,
        message: str(body, 'message') || null,
        status: 'pending',
        source: 'admin',
      },
    });
    return { ok: true as const, booking, schedule, tour: schedule.tour };
  });

  if (!result.ok) throw fail(result.status, result.error);

  const commonNotifyOpts = {
    tourTitle: result.tour.title,
    guestName: name,
    guests: guestCount,
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
  }).catch(err => console.error('[tour-bookings] host notify failed:', err));
  notifyTourGuestOfBooking({ ...commonNotifyOpts, guestPhone: trimmedPhone || null })
    .catch(err => console.error('[tour-bookings] guest notify failed:', err));

  return created(result.booking);
});

const BOOKING_STATUSES = ['pending', 'forwarded', 'confirmed', 'cancelled', 'completed'] as const;
const BOOKING_WRITABLE_FIELDS = ['name', 'phone', 'email', 'message'] as const;

export const PUT = withAuth('tour-bookings', async (req, { auth }) => {
  const body = await readJson(req);
  const id = str(body, 'id', { required: true })!;
  const before = await authorizeTourBooking(id, auth.session.userId, { isAdmin: auth.isAdmin });
  if (!before) throw fail(403, MESSAGES.forbidden);

  const status = str(body, 'status');
  if (status !== undefined && !(BOOKING_STATUSES as readonly string[]).includes(status)) throw fail(400, '잘못된 status 값입니다.');

  // Cancellation: free up the inventory.
  if (status === 'cancelled') {
    if (before.status !== 'cancelled') {
      await prisma.$transaction([
        prisma.tourBooking.update({ where: { id }, data: { status: 'cancelled' } }),
        prisma.tourSchedule.update({ where: { id: before.scheduleId }, data: { bookedCount: { decrement: before.guests } } }),
      ]);
    }
    return ok({ success: true });
  }

  // Allow only specific fields — never tourId/scheduleId/guests/totalPrice/etc.
  const data: Record<string, unknown> = {};
  for (const key of BOOKING_WRITABLE_FIELDS) if (key in body) data[key] = body[key];
  if (status) data.status = status;

  return ok(await prisma.tourBooking.update({ where: { id }, data: data as Parameters<typeof prisma.tourBooking.update>[0]['data'] }));
});
