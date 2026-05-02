import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySession, getSessionWithUser } from '@/lib/auth';
import { notifyTourHostOfBooking, notifyTourGuestOfBooking } from '@/lib/notify';

export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const tourId = searchParams.get('tourId');
    const status = searchParams.get('status');

    const ownerFilter = auth.isAdmin ? {} : { tour: { ownerId: auth.session.userId } };

    const bookings = await prisma.tourBooking.findMany({
      where: {
        ...ownerFilter,
        ...(tourId ? { tourId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        tour: {
          select: {
            id: true, title: true,
            operator: { select: { id: true, name: true, contactPhone: true, email: true } },
          },
        },
        schedule: { select: { date: true, startTime: true } },
        durationOption: { select: { id: true, label: true, durationMin: true, price: true } },
      },
    });

    return NextResponse.json(
      bookings.map(b => ({
        id: b.id,
        tourId: b.tourId,
        scheduleId: b.scheduleId,
        name: b.name,
        phone: b.phone,
        email: b.email,
        guests: b.guests,
        durationMin: b.durationMin,
        unitPrice: b.unitPrice ? Number(b.unitPrice) : null,
        totalPrice: b.totalPrice ? Number(b.totalPrice) : null,
        status: b.status,
        forwardedAt: b.forwardedAt,
        message: b.message,
        source: b.source,
        createdAt: b.createdAt,
        tour: {
          id: b.tour.id,
          title: b.tour.title,
          operator: b.tour.operator,
        },
        schedule: b.schedule,
        durationOption: b.durationOption ? {
          id: b.durationOption.id,
          label: b.durationOption.label,
          durationMin: b.durationOption.durationMin,
          price: Number(b.durationOption.price),
        } : null,
      })),
    );
  } catch (e) {
    console.error('[tour-bookings] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { scheduleId, durationOptionId, name, phone, email, guests, message, bookingId } = body;
    if (!scheduleId || !name || !guests) {
      return NextResponse.json({ error: '이름, 슬롯, 인원은 필수입니다.' }, { status: 400 });
    }
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
    const guestCount = Math.max(1, Number(guests) || 1);

    const result = await prisma.$transaction(async (tx) => {
      const schedule = await tx.tourSchedule.findUnique({
        where: { id: scheduleId },
        include: {
          tour: {
            include: {
              operator: true,
              durationOptions: true,
              owner: { select: { id: true, displayName: true, email: true, phone: true } },
            },
          },
        },
      });
      if (!schedule) return { error: '슬롯을 찾을 수 없습니다.' as const, status: 404 };
      if (schedule.capacity - schedule.bookedCount < guestCount) {
        return { error: `남은 자리는 ${schedule.capacity - schedule.bookedCount}명입니다.` as const, status: 409 };
      }

      let durationOption = null as null | (typeof schedule.tour.durationOptions)[number];
      if (durationOptionId) {
        durationOption = schedule.tour.durationOptions.find(o => o.id === durationOptionId) ?? null;
      }

      const updated = await tx.tourSchedule.updateMany({
        where: { id: scheduleId, bookedCount: { lte: schedule.capacity - guestCount } },
        data: { bookedCount: { increment: guestCount } },
      });
      if (updated.count === 0) {
        return { error: '동시 예약이 발생했습니다. 다시 시도해주세요.' as const, status: 409 };
      }

      const unitPrice = durationOption
        ? Number(durationOption.price)
        : schedule.tour.basePrice ? Number(schedule.tour.basePrice) : null;
      const durationMin = durationOption?.durationMin ?? schedule.tour.durationMin ?? null;
      const totalPrice = unitPrice !== null ? unitPrice * guestCount : null;

      const booking = await tx.tourBooking.create({
        data: {
          tourId: schedule.tourId,
          scheduleId: schedule.id,
          durationOptionId: durationOption?.id ?? null,
          durationMin,
          unitPrice,
          bookingId: bookingId || null,
          name,
          phone: trimmedPhone,
          email: email || null,
          guests: guestCount,
          totalPrice,
          message: message || null,
          status: 'pending',
          source: 'admin',
        },
      });
      return { ok: true as const, booking, schedule, tour: schedule.tour };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

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
      ...commonNotifyOpts,
      guestPhone: trimmedPhone || null,
      hostPhone: result.tour.owner.phone,
      hostName: result.tour.owner.displayName ?? result.tour.owner.email,
    }).catch(err => console.error('[tour-bookings] host notify failed:', err));

    notifyTourGuestOfBooking({
      ...commonNotifyOpts,
      guestPhone: trimmedPhone || null,
    }).catch(err => console.error('[tour-bookings] guest notify failed:', err));

    return NextResponse.json(result.booking, { status: 201 });
  } catch (e) {
    console.error('[tour-bookings] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { id, status, ...rest } = body;
    if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

    // Cancellation: free up the inventory.
    if (status === 'cancelled') {
      const before = await prisma.tourBooking.findUnique({
        where: { id },
        select: { status: true, scheduleId: true, guests: true },
      });
      if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

      if (before.status !== 'cancelled') {
        await prisma.$transaction([
          prisma.tourBooking.update({ where: { id }, data: { status: 'cancelled' } }),
          prisma.tourSchedule.update({
            where: { id: before.scheduleId },
            data: { bookedCount: { decrement: before.guests } },
          }),
        ]);
      }
      return NextResponse.json({ success: true });
    }

    const updated = await prisma.tourBooking.update({
      where: { id },
      data: { ...rest, ...(status ? { status } : {}) },
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error('[tour-bookings] PUT error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
