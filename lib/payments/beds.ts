import { beds24Get, beds24Post } from '@/lib/beds24';
import { fetchBeds24BookingById, type Beds24Booking } from '@/lib/beds24-booking';
import type { CheckoutOrder } from '@/generated/prisma/client';
import { toMinor } from './money';

export const checkoutMarker = (id: string) => `void-checkout:${id}`;

export function selectOffer(raw: unknown, roomId: number, offerId: number) {
  const data = raw as { data?: { roomId: number; offers?: { offerId: number; price: number; unitsAvailable: number }[] }[] };
  const offer = data.data?.find(r => r.roomId === roomId)?.offers?.find(o => o.offerId === offerId && o.unitsAvailable > 0);
  if (!offer) throw new Error('선택한 일정에 판매 가능한 요금이 없습니다. / No available offer.');
  return toMinor(offer.price, 'KRW');
}

export async function getPrice(roomId: number, offerId: number, checkIn: string, checkOut: string, guests: number) {
  return selectOffer(await beds24Get('/inventory/rooms/offers', {
    roomId: String(roomId), offerId: String(offerId), arrival: checkIn, departure: checkOut, numAdults: String(guests), numChildren: '0',
  }), roomId, offerId);
}

export function assertHold(order: Pick<CheckoutOrder, 'id' | 'roomId' | 'checkIn' | 'checkOut'>, booking: Beds24Booking | null) {
  if (!booking || booking.custom1 !== checkoutMarker(order.id) || Number(booking.roomId) !== order.roomId ||
      booking.arrival?.slice(0, 10) !== order.checkIn || booking.departure?.slice(0, 10) !== order.checkOut ||
      !['black', 'confirmed'].includes(String(booking.status))) throw new Error('Reserved room could not be verified');
  return booking;
}

export async function findHold(order: CheckoutOrder) {
  if (order.beds24Id) return fetchBeds24BookingById(order.beds24Id);
  // Recovery only. Never blindly POST a second reservation after an uncertain response.
  for (let page = 1; page <= 5; page++) {
    const result = await beds24Get('/bookings', { roomId: String(order.roomId), arrivalFrom: order.checkIn, arrivalTo: order.checkIn, page: String(page) });
    const found = (result.data as Beds24Booking[] | undefined)?.find(b => b.custom1 === checkoutMarker(order.id));
    if (found) return found;
    if (!result.pages?.nextPageExists) break;
  }
  return null;
}

export async function createHold(order: CheckoutOrder) {
  const raw = await beds24Post('/bookings', [{
    roomId: order.roomId, arrival: order.checkIn, departure: order.checkOut, roomQty: 1,
    firstName: '결제 대기', lastName: '', status: 'black', numAdult: order.guests, numChild: 0,
    custom1: checkoutMarker(order.id), notes: `온라인 결제 대기 / expires ${order.expiresAt.toISOString()}`,
    actions: { checkAvailability: true, notifyGuest: false, notifyHost: false },
  }]);
  const item = Array.isArray(raw) ? raw[0] : null;
  if (!item?.success || !Number.isSafeInteger(Number(item?.new?.id))) throw new Error('Room hold response unverified; recovery required');
  return String(item.new.id);
}

export async function finalizeHold(order: CheckoutOrder) {
  const booking = assertHold(order, await findHold(order));
  if (booking.status !== 'confirmed') {
    await beds24Post('/bookings', [{ id: booking.id, status: 'confirmed', firstName: order.name, lastName: '',
      email: order.email, phone: order.phone, price: order.priceKrw, numAdult: order.guests,
      notes: `void anchae paid order ${order.id}; ${order.currency} ${order.amountMinor}; payment recorded in void anchae`,
      actions: { notifyGuest: false, notifyHost: false },
    }]);
  }
  const verified = assertHold(order, await fetchBeds24BookingById(booking.id));
  if (verified.status !== 'confirmed') throw new Error('Booking confirmation is pending');
  return String(verified.id);
}

export async function releaseHold(order: CheckoutOrder) {
  const booking = await findHold(order);
  if (!booking) {
    if (order.beds24Id) return; // Known deleted booking.
    throw new Error('Unknown hold outcome; manual review required');
  }
  if (booking.custom1 !== checkoutMarker(order.id) || Number(booking.roomId) !== order.roomId) throw new Error('Hold identity mismatch');
  if (booking.status === 'cancelled') return;
  await beds24Post('/bookings', [{ id: booking.id, status: 'cancelled', actions: { notifyGuest: false } }]);
  const verified = await fetchBeds24BookingById(booking.id);
  if (verified && verified.status !== 'cancelled') throw new Error('Room release is pending');
}
