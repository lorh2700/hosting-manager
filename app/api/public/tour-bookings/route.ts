import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notifyTourHostOfBooking, notifyTourGuestOfBooking } from '@/lib/notify';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { scheduleId, durationOptionId, name, phone, email, guests, message } = body;

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
      if (schedule.status !== 'open') return { error: '마감된 슬롯입니다.' as const, status: 410 };
      if (!schedule.tour.isActive) return { error: '판매 중지된 투어입니다.' as const, status: 410 };

      // Resolve chosen course option (if any) and snapshot price/duration.
      let durationOption = null as null | (typeof schedule.tour.durationOptions)[number];
      if (durationOptionId) {
        durationOption = schedule.tour.durationOptions.find(o => o.id === durationOptionId) ?? null;
        if (!durationOption) {
          return { error: '선택한 코스를 찾을 수 없습니다.' as const, status: 400 };
        }
      } else if (schedule.tour.durationOptions.length > 0) {
        return { error: '코스를 선택해주세요.' as const, status: 400 };
      }

      const remaining = schedule.capacity - schedule.bookedCount;
      if (remaining < guestCount) {
        return { error: `남은 자리는 ${remaining}명입니다.` as const, status: 409 };
      }

      const updated = await tx.tourSchedule.updateMany({
        where: {
          id: scheduleId,
          status: 'open',
          bookedCount: { lte: schedule.capacity - guestCount },
        },
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
          name,
          phone: trimmedPhone, // empty string when guest didn't provide
          email: email || null,
          guests: guestCount,
          totalPrice,
          message: message || null,
          status: 'pending',
          source: 'direct',
        },
      });

      return {
        ok: true as const,
        booking,
        schedule,
        tour: schedule.tour,
        operator: schedule.tour.operator,
        durationOption,
      };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Forward to operator (best-effort, doesn't block response).
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

    // Host notification — sent to the tour owner's phone (always attempted)
    notifyTourHostOfBooking({
      ...commonNotifyOpts,
      guestPhone: trimmedPhone || null,
      hostPhone: result.tour.owner.phone,
      hostName: result.tour.owner.displayName ?? result.tour.owner.email,
    }).catch(err => console.error('[public/tour-bookings] host notify failed:', err));

    // Guest confirmation — only when guest provided a phone number.
    // Falls back to plain SMS when no alimtalk template is configured.
    notifyTourGuestOfBooking({
      ...commonNotifyOpts,
      guestPhone: trimmedPhone || null,
    }).catch(err => console.error('[public/tour-bookings] guest notify failed:', err));

    return NextResponse.json({ success: true, bookingId: result.booking.id }, { status: 201 });
  } catch (error) {
    console.error('[public/tour-bookings] POST error:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 },
    );
  }
}
