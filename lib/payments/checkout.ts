import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CheckoutOrder } from '@/generated/prisma/client';
import { beds24Get } from '@/lib/beds24';
import { todayKst } from '@/lib/dates';
import { ensureCleaningsForProperty } from '@/lib/sync-engine';
import { fail } from '@/lib/core/http';
import { checkoutConfig, paymentKeys } from './config';
import { assertPayment, chargeAmount, majorAmount } from './money';
import { assertHold, createHold, finalizeHold, findHold, getPrice, releaseHold } from './beds';
import { TossError } from './toss';
import { confirmPayment, getPayment, refundPayment } from './provider';
import { PayPalError, startPayPal } from './paypal';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
// Properties migrated from Firestore retain their original document IDs.
// Checkout order IDs are UUIDs, but property IDs may also be legacy IDs.
const inputSchema = z.object({ propertyId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/), checkIn: date, checkOut: date,
  guests: z.number().int().min(1).max(20), name: z.string().trim().min(1).max(80),
  email: z.email().max(100), phone: z.string().trim().min(6).max(40), gateway: z.enum(['card', 'paypal']),
});

export async function priceStay(raw: unknown) {
  const parsed = inputSchema.pick({ propertyId: true, checkIn: true, checkOut: true, guests: true }).safeParse(raw);
  if (!parsed.success) throw fail(400, '숙소·날짜·인원을 확인해주세요.');
  const data = parsed.data;
  const nights = (Date.parse(data.checkOut) - Date.parse(data.checkIn)) / 86400000;
  if (data.checkIn < todayKst() || nights < 1 || nights > 30) throw fail(400, '1~30박의 미래 일정을 선택해주세요.');
  const property = await prisma.property.findUnique({ where: { id: data.propertyId } });
  if (!property || property.status !== 'active' || !property.beds24RoomId || !property.beds24PropId || !property.maxGuests || data.guests > property.maxGuests) throw fail(400, '이 숙소의 온라인 요금을 조회할 수 없습니다.');
  const roomId = Number(property.beds24RoomId);
  const offerId = Number(process.env.CHECKOUT_BEDS24_OFFER_ID);
  if (!Number.isSafeInteger(roomId) || roomId < 1 || !Number.isSafeInteger(offerId) || offerId < 1) throw fail(503, '숙소 요금 설정을 확인 중입니다.');
  const details = await beds24Get('/properties', { id: String(property.beds24PropId) });
  if (details.data?.find((p: { id: number }) => String(p.id) === String(property.beds24PropId))?.currency !== 'KRW') throw fail(400, '현재 원화로 설정한 숙소만 지원합니다.');
  const priceKrw = await getPrice(roomId, offerId, data.checkIn, data.checkOut, data.guests);
  return { priceKrw, currency: 'KRW', nights, roomId, offerId, propertyName: property.name,
    includesAllFees: process.env.CHECKOUT_PRICE_INCLUDES_ALL_FEES === 'true' };
}

export async function quoteCheckout(raw: unknown) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw fail(400, '예약자 정보와 일정을 확인해 주세요. / Please check your details.');
  const data = parsed.data;
  const nights = (Date.parse(data.checkOut) - Date.parse(data.checkIn)) / 86400000;
  if (data.checkIn < todayKst() || nights < 1 || nights > 30) throw fail(400, '1~30박의 미래 일정을 선택해주세요.');
  const config = checkoutConfig(data.propertyId, data.gateway);
  const recent = await prisma.checkoutOrder.count({ where: { email: data.email, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } } });
  if (recent >= 10) throw fail(429, '요금 조회 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.');
  const { priceKrw, roomId, propertyName } = await priceStay(data);
  const amount = chargeAmount(priceKrw, data.gateway, process.env.CHECKOUT_KRW_PER_USD);
  const token = randomBytes(32).toString('base64url');
  const order = await prisma.checkoutOrder.create({ data: { ...data, ...amount, priceKrw,
    tokenHash: hash(token), roomId, offerId: config.offerId, propertyName,
    mode: config.mode, terms: config.terms, expiresAt: new Date(Date.now() + 5 * 60_000),
  } });
  return { ...publicOrder(order), token };
}

export function publicOrder(o: CheckoutOrder) {
  return { id: o.id, status: o.status, propertyName: o.propertyName, checkIn: o.checkIn, checkOut: o.checkOut,
    guests: o.guests, currency: o.currency, amount: majorAmount(o), gateway: o.gateway, priceKrw: o.priceKrw,
    fxRate: o.fxRate, terms: o.terms, expiresAt: o.expiresAt, bookingId: o.bookingId, mode: o.mode };
}

export async function authorizedOrder(id: string, token: string) {
  if (!token || token.length > 100 || !z.uuid().safeParse(id).success) throw fail(404, '결제 요청을 찾을 수 없습니다.');
  const order = await prisma.checkoutOrder.findUnique({ where: { id } });
  if (!order || order.tokenHash !== hash(token)) throw fail(404, '결제 요청을 찾을 수 없습니다.');
  return order;
}

// A database lease serializes start / confirm / expiry / refund across processes.
// External calls have shorter timeouts; durable states survive a crashed Netlify invocation.
async function withLease(id: string, work: (o: CheckoutOrder) => Promise<void>) {
  const now = new Date();
  const leaseUntil = new Date(Date.now() + 180_000);
  const claim = await prisma.checkoutOrder.updateMany({ where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseUntil } });
  if (!claim.count) throw fail(409, '처리 중입니다. 잠시 후 다시 확인해주세요. / Processing; please retry shortly.');
  try {
    const order = await prisma.checkoutOrder.findUniqueOrThrow({ where: { id } });
    await work(order);
    await prisma.checkoutOrder.updateMany({ where: { id, status: { not: 'review' } }, data: { lastError: null } });
  } catch (e) {
    // Do not persist raw provider payloads, keys, or guest details.
    const code = e instanceof TossError || e instanceof PayPalError ? e.code : 'PROCESSING_RETRY_REQUIRED';
    await prisma.checkoutOrder.update({ where: { id }, data: { lastError: code,
      ...(['CAPTURE_REQUIRES_REVIEW', 'REFUND_REQUIRES_REVIEW', 'MULTIPLE_CAPTURES', 'AMOUNT_MISMATCH', 'ORDER_MISMATCH', 'CAPTURE_MISMATCH', 'REFUND_MISMATCH'].includes(code) ? { status: 'review' } : {}) } });
    throw e;
  } finally {
    await prisma.checkoutOrder.updateMany({ where: { id, leaseUntil }, data: { leaseUntil: null } });
  }
  return prisma.checkoutOrder.findUniqueOrThrow({ where: { id } });
}

export async function startCheckout(order: CheckoutOrder) {
  const config = checkoutConfig(order.propertyId, order.gateway as 'card' | 'paypal');
  let paypalStart: { approvalUrl?: string; resumeConfirmation?: boolean } = {};
  const updated = await withLease(order.id, async o => {
    if (o.status === 'awaiting_payment' && o.expiresAt > new Date()) {
      assertHold(o, await findHold(o));
      if (o.gateway === 'paypal') paypalStart = await startPayPal(o, config.origin);
      return;
    }
    if (o.status !== 'quoted' || o.expiresAt <= new Date()) throw fail(409, '견적이 만료되었습니다. 요금을 다시 확인해주세요.');
    const latest = await getPrice(o.roomId, o.offerId, o.checkIn, o.checkOut, o.guests);
    if (latest !== o.priceKrw) throw fail(409, '판매 요금이 변경되었습니다. 요금을 다시 확인해주세요.');
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await prisma.checkoutOrder.update({ where: { id: o.id }, data: { status: 'holding', expiresAt, termsAcceptedAt: new Date() } });
    // One create attempt only: an ambiguous result is recovered by marker, never reposted.
    const beds24Id = await createHold({ ...o, expiresAt });
    await prisma.checkoutOrder.update({ where: { id: o.id }, data: { beds24Id } });
    const held = { ...o, beds24Id };
    assertHold(held, await findHold(held));
    const ready = await prisma.checkoutOrder.update({ where: { id: o.id }, data: { status: 'awaiting_payment' } });
    if (o.gateway === 'paypal') paypalStart = await startPayPal(ready, config.origin);
  });
  if (updated.status !== 'awaiting_payment') throw fail(409, '예약 확보 상태를 확인 중입니다.');
  if (updated.gateway === 'paypal') return { ...publicOrder(updated), ...paypalStart };
  const { clientKey } = paymentKeys(updated.gateway, updated.mode);
  return { ...publicOrder(updated), clientKey, customerName: updated.name, customerEmail: updated.email };
}

async function saveConfirmed(o: CheckoutOrder) {
  const held = await findHold(o);
  try { assertHold(o, held); }
  catch {
    await prisma.checkoutOrder.update({ where: { id: o.id }, data: { status: 'refund_pending' } });
    throw new Error('Paid reservation unavailable; refund queued');
  }
  const beds24Id = await finalizeHold(o);
  await prisma.$transaction(async tx => {
    const booking = await tx.booking.upsert({ where: { id: o.bookingId ?? o.id },
      create: { id: o.id, propertyId: o.propertyId, name: o.name, email: o.email, phone: o.phone, guests: o.guests,
        checkIn: o.checkIn, checkOut: o.checkOut, status: 'confirmed', source: 'direct', channelBookingRef: beds24Id },
      update: { status: 'confirmed', channelBookingRef: beds24Id },
    });
    const event = { source: 'direct', title: o.name, startDate: o.checkIn, endDate: o.checkOut, type: 'reservation', guestEmail: o.email, guestPhone: o.phone, numAdults: o.guests, numChildren: 0 };
    await tx.event.upsert({ where: { propertyId_channelId_originalUid: { propertyId: o.propertyId, channelId: 'beds24', originalUid: beds24Id } },
      create: { propertyId: o.propertyId, channelId: 'beds24', originalUid: beds24Id, ...event }, update: event });
    await tx.checkoutOrder.update({ where: { id: o.id }, data: { status: 'confirmed', beds24Id, bookingId: booking.id } });
  });
  // The regular sync also reconciles cleanings if this request ends here.
  await ensureCleaningsForProperty(o.propertyId).catch(() => console.error('[checkout] cleaning reconciliation pending', o.id));
}

async function clearReservation(o: CheckoutOrder, status: string) {
  await releaseHold(o);
  await prisma.$transaction(async tx => {
    if (o.bookingId) await tx.booking.update({ where: { id: o.bookingId }, data: { status: 'cancelled' } });
    if (o.beds24Id) await tx.event.deleteMany({ where: { propertyId: o.propertyId, channelId: 'beds24', originalUid: o.beds24Id } });
    await tx.checkoutOrder.update({ where: { id: o.id }, data: { status } });
  });
  await ensureCleaningsForProperty(o.propertyId).catch(() => console.error('[checkout] cleaning reconciliation pending', o.id));
}

export async function reconcileCheckout(id: string, approve = false) {
  return withLease(id, async original => {
    let o = original;
    if (['expired', 'refunded', 'review'].includes(o.status)) return;
    if (o.status === 'quoted') {
      if (o.expiresAt <= new Date()) await prisma.checkoutOrder.update({ where: { id }, data: { status: 'expired' } });
      return;
    }
    if (o.status === 'holding') {
      const found = await findHold(o);
      if (!found) {
        // Unknown response is not evidence of failure. Keep blocked from payment for inspection.
        if (Date.now() - o.createdAt.getTime() > 60 * 60_000) await prisma.checkoutOrder.update({ where: { id }, data: { status: 'review', lastError: 'HOLD_OUTCOME_UNKNOWN' } });
        return;
      }
      assertHold(o, found);
      o = await prisma.checkoutOrder.update({ where: { id }, data: { beds24Id: String(found.id), status: 'awaiting_payment' } });
    }
    // No PayPal approval URL can be returned until paymentKey is saved. A lost create
    // response therefore cannot have charged the guest and this hold can safely expire.
    if (o.gateway === 'paypal' && !o.paymentKey && o.status === 'awaiting_payment') {
      if (o.expiresAt <= new Date()) await clearReservation(o, 'expired');
      return;
    }
    let payment;
    try { payment = await getPayment(o); }
    catch (e) {
      if (e instanceof TossError && e.code === 'NOT_FOUND_PAYMENT' && o.expiresAt <= new Date() && o.status === 'awaiting_payment') {
        await clearReservation(o, 'expired'); return;
      }
      throw e;
    }
    assertPayment(o, payment);
    if (payment.status === 'PARTIAL_CANCELED') {
      await prisma.checkoutOrder.update({ where: { id }, data: { status: 'review', lastError: 'PARTIAL_REFUND_REVIEW' } }); return;
    }
    if (o.status === 'refund_pending') {
      if (payment.status !== 'CANCELED') payment = await refundPayment(o);
      assertPayment(o, payment);
      if (payment.status !== 'CANCELED') throw new Error('Refund verification pending');
      await clearReservation(o, 'refunded'); return;
    }
    if (payment.status === 'CANCELED') { await clearReservation(o, 'refunded'); return; }
    if (payment.status === 'IN_PROGRESS' && (o.status === 'approving' || (approve && o.expiresAt > new Date() && o.status === 'awaiting_payment'))) {
      assertHold(o, await findHold(o));
      // Persist identity before approval so interrupted approval can be reconciled.
      o = await prisma.checkoutOrder.update({ where: { id }, data: { paymentKey: payment.paymentKey, status: 'approving' } });
      payment = await confirmPayment(o, payment.paymentKey);
      assertPayment(o, payment);
    }
    if (payment.status === 'DONE') {
      o = await prisma.checkoutOrder.update({ where: { id }, data: { paymentKey: payment.paymentKey, status: o.status === 'confirmed' ? 'confirmed' : 'fulfilling' } });
      if (o.status !== 'confirmed') await saveConfirmed(o);
    } else if (o.expiresAt <= new Date() && o.status === 'awaiting_payment' && ['READY', 'IN_PROGRESS', 'ABORTED', 'EXPIRED'].includes(payment.status)) {
      await clearReservation(o, 'expired');
    } else if (o.status === 'approving' && ['ABORTED', 'EXPIRED'].includes(payment.status)) {
      await clearReservation(o, 'expired');
    }
  });
}

export async function requestRefund(id: string) {
  await withLease(id, async o => {
    if (!['confirmed', 'fulfilling', 'refund_pending'].includes(o.status)) throw fail(409, '결제 완료 건만 전액 환불할 수 있습니다.');
    await prisma.checkoutOrder.update({ where: { id }, data: { status: 'refund_pending' } });
  });
  return reconcileCheckout(id);
}
