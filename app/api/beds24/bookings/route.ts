import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionWithUser, canManageProperty } from '@/lib/auth';
import {
  beds24Put,
  beds24WithRetry,
  describeBeds24Error,
  isBeds24TransientError,
  Beds24NetworkError,
  BEDS24_REFRESH_TOKEN,
} from '@/lib/beds24';
import {
  createBeds24Booking,
  findMatchingBeds24Booking,
  verifyBeds24Booking,
  Beds24BookingRejectedError,
  Beds24UnexpectedResponseError,
  type BookingVerification,
} from '@/lib/beds24-booking';

// Netlify 함수 타임아웃(26s) 안에서 사전조회 → 생성 → 최종확인 → 저장까지 끝내기 위한 예산.
const ROUTE_BUDGET_MS = 22_000;

function forbidden() {
  return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
}

/**
 * 예약 관리 페이지의 Beds24 예약 생성.
 * /api/beds24/reservations 와 같은 원칙: Beds24 에 예약이 확인된 뒤에만 플랫폼 Booking 을 저장한다.
 * Beds24 booking id 는 channelBookingRef 에 보관해 취소가 Beds24 에도 반영되게 한다.
 */
export async function POST(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN is not configured' }, { status: 500 });
  }
  const deadlineAt = Date.now() + ROUTE_BUDGET_MS;

  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { propertyId, firstName, lastName, email, phone, numAdult, numChild, arrival, departure, notes } = body;

    if (!propertyId || !arrival || !departure || !firstName) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }
    if (String(arrival) >= String(departure)) {
      return NextResponse.json({ error: '체크아웃은 체크인보다 뒤여야 합니다.' }, { status: 400 });
    }
    if (!canManageProperty(auth, String(propertyId))) return forbidden();

    // Beds24 숙소 id 는 body 가 아니라 DB 설정에서 가져온다.
    const property = await prisma.property.findUnique({
      where: { id: String(propertyId) },
      select: { beds24PropId: true },
    });
    if (!property) return NextResponse.json({ error: '숙소를 찾을 수 없습니다.' }, { status: 404 });
    if (!property.beds24PropId) {
      return NextResponse.json({ error: '이 숙소에는 Beds24 연동이 설정되어 있지 않습니다.' }, { status: 400 });
    }

    const identity = {
      propertyId: Number(property.beds24PropId),
      arrival: String(arrival),
      departure: String(departure),
      firstName: String(firstName || ''),
      lastName: String(lastName || ''),
    };

    let beds24BookingId: number | null = null;

    // 1) 재시도 시 중복 생성 방지: 같은 숙소·날짜·이름의 활성 예약이 이미 있으면 재사용
    try {
      const existing = await findMatchingBeds24Booking(identity, { timeoutMs: 8_000 });
      if (existing) {
        beds24BookingId = existing.id;
        console.log(`[beds24/bookings] reusing existing Beds24 booking #${existing.id}`);
      }
    } catch (e) {
      console.warn('[beds24/bookings] pre-check failed, proceeding to create:', describeBeds24Error(e));
    }

    // 2) 생성 — 5xx/429/토큰 오류만 바로 재시도, 네트워크 오류(응답 유실)는 조회로 복구
    if (beds24BookingId === null) {
      try {
        const created = await beds24WithRetry(
          'create booking',
          () => createBeds24Booking({
            ...identity,
            email: email || '',
            phone: phone || '',
            numAdult: Number(numAdult) || 1,
            numChild: Number(numChild) || 0,
            notes: notes || '',
            status: 'confirmed',
          }, { timeoutMs: 12_000 }),
          {
            attempts: 2,
            baseDelayMs: 1_500,
            deadlineAt,
            shouldRetry: (e) => isBeds24TransientError(e) && !(e instanceof Beds24NetworkError),
          },
        );
        beds24BookingId = created.id;
      } catch (e) {
        if (e instanceof Beds24BookingRejectedError) {
          return NextResponse.json({ error: `Beds24가 예약을 거부했습니다: ${e.message}` }, { status: 422 });
        }
        if (e instanceof Beds24NetworkError || e instanceof Beds24UnexpectedResponseError) {
          try {
            const found = await findMatchingBeds24Booking(identity, { timeoutMs: 8_000 });
            if (found) {
              beds24BookingId = found.id;
              console.log(`[beds24/bookings] recovered Beds24 booking #${found.id} after ${e.name}`);
            }
          } catch (lookupErr) {
            console.warn('[beds24/bookings] recovery lookup failed:', describeBeds24Error(lookupErr));
          }
        }
        if (beds24BookingId === null) {
          console.error('[beds24/bookings] Beds24 booking creation failed:', e);
          return NextResponse.json({
            error: `Beds24에 예약을 등록하지 못했습니다 (${describeBeds24Error(e)}). 플랫폼에는 저장되지 않았습니다. 잠시 후 다시 시도해주세요. 같은 예약이 Beds24에 이미 생성돼 있으면 중복 없이 이어서 등록됩니다.`,
          }, { status: 502 });
        }
      }
    }

    // 3) 최종 확인: Beds24 에 예약이 실제로 존재하고 숙소/날짜가 일치하는지
    let verification: BookingVerification;
    try {
      verification = await verifyBeds24Booking(
        beds24BookingId,
        { propertyId: identity.propertyId, arrival: identity.arrival, departure: identity.departure },
        { deadlineAt, notFoundRetries: 1 },
      );
    } catch (e) {
      console.error(`[beds24/bookings] verification of Beds24 booking #${beds24BookingId} inconclusive:`, e);
      return NextResponse.json({
        error: `Beds24 예약(#${beds24BookingId})은 생성되었지만 최종 확인에 실패했습니다 (${describeBeds24Error(e)}). 플랫폼에는 저장되지 않았습니다. 잠시 후 다시 시도하면 중복 없이 확인 후 저장됩니다.`,
        beds24BookingId: String(beds24BookingId),
      }, { status: 502 });
    }
    if (!verification.ok) {
      return NextResponse.json({
        error: `Beds24 예약(#${beds24BookingId}) 확인 결과가 일치하지 않습니다: ${verification.detail} 플랫폼에는 저장되지 않았습니다.`,
        beds24BookingId: String(beds24BookingId),
      }, { status: 409 });
    }

    // 4) 플랫폼 저장 (Beds24 확인 완료 후에만). 같은 Beds24 예약이 이미 저장돼 있으면 재사용.
    const guestName = [firstName, lastName].filter(Boolean).join(' ');
    const ref = String(beds24BookingId);
    const already = await prisma.booking.findFirst({
      where: { propertyId: String(propertyId), channelBookingRef: ref },
      select: { id: true },
    });
    const booking = already ?? await prisma.booking.create({
      data: {
        propertyId: String(propertyId),
        name: guestName,
        email: email || '',
        phone: phone || '',
        guests: (Number(numAdult) || 1) + (Number(numChild) || 0),
        checkIn: identity.arrival,
        checkOut: identity.departure,
        status: 'confirmed',
        message: notes || '',
        source: 'beds24',
        channelBookingRef: ref,
      },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      bookingId: booking.id,
      beds24BookingId: ref,
      verified: true,
      reused: !!already,
    }, { status: 201 });
  } catch (error) {
    console.error('Beds24 booking creation error:', error);
    return NextResponse.json({ error: describeBeds24Error(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN is not configured' }, { status: 500 });
  }

  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { beds24BookingId, bookingId, action } = body;

    if (!bookingId || !action) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: String(bookingId) },
      select: { id: true, propertyId: true, channelBookingRef: true, status: true },
    });
    if (!booking) return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    if (!canManageProperty(auth, booking.propertyId)) return forbidden();

    if (action === 'cancel') {
      // 화면이 보낸 id 보다 DB 에 저장된 Beds24 참조를 우선한다.
      const ref = booking.channelBookingRef || (beds24BookingId ? String(beds24BookingId) : null);
      if (ref) {
        try {
          // 취소(PUT status)는 멱등이므로 일시 오류에 재시도해도 안전.
          await beds24WithRetry(
            `cancel booking #${ref}`,
            () => beds24Put('/bookings', [{ id: Number(ref), status: 'cancelled' }]),
            { attempts: 2, baseDelayMs: 1_000 },
          );
        } catch (e) {
          console.error('[beds24/bookings] Beds24 cancel failed:', e);
          return NextResponse.json({
            error: `Beds24에서 예약 취소에 실패했습니다 (${describeBeds24Error(e)}). 플랫폼 상태는 변경하지 않았습니다.`,
          }, { status: 502 });
        }
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'cancelled' },
      });

      return NextResponse.json({ success: true, beds24Cancelled: !!ref });
    }

    return NextResponse.json({ error: '알 수 없는 작업입니다.' }, { status: 400 });
  } catch (error) {
    console.error('Beds24 booking update error:', error);
    return NextResponse.json({ error: describeBeds24Error(error) }, { status: 500 });
  }
}
