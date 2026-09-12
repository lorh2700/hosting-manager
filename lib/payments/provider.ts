import type { CheckoutOrder } from '@/generated/prisma/client';
import * as toss from './toss';
import { capturePayPal, getPayPalPayment, refundPayPal } from './paypal';

export const getPayment = (o: CheckoutOrder) => o.gateway === 'paypal' ? getPayPalPayment(o) : toss.getPayment(o);
export const confirmPayment = (o: CheckoutOrder, key: string) => o.gateway === 'paypal' ? capturePayPal(o) : toss.confirmPayment(o, key);
export const refundPayment = (o: CheckoutOrder) => o.gateway === 'paypal' ? refundPayPal(o) : toss.refundPayment(o);
