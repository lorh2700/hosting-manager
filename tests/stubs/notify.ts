/** '@/lib/notify' 스텁 — 발송 대신 호출만 기록한다. 실제 발송 로직은 '../lib/notify' 를 직접 import 해 검증. */
export type CleaningCancelReason = 'deleted' | 'reassigned' | 'unassigned';

export const notifyCalls = {
  cancelled: [] as any[],
  assigned: [] as any[],
  newOpen: [] as any[],
  application: [] as any[],
  tourOperator: [] as any[],
  tourHost: [] as any[],
  tourGuest: [] as any[],
  checkout: [] as any[],
  checkoutCandidate: [] as any[],
};

export function resetNotify() {
  for (const k of Object.keys(notifyCalls) as (keyof typeof notifyCalls)[]) notifyCalls[k].length = 0;
}

const ok = { ok: true, provider: 'stub' };

export async function notifyCleaningCancelled(opts: any) { notifyCalls.cancelled.push(opts); return ok; }
export async function notifyCleaningAssigned(opts: any) { notifyCalls.assigned.push(opts); return ok; }
export async function notifyNewOpenCleanings(opts: any) { notifyCalls.newOpen.push(opts); }
export async function notifyHostOfCleaningApplication(opts: any) { notifyCalls.application.push(opts); return ok; }
export async function notifyTourOperatorOfBooking(opts: any) { notifyCalls.tourOperator.push(opts); }
export async function notifyTourHostOfBooking(opts: any) { notifyCalls.tourHost.push(opts); return ok; }
export async function notifyTourGuestOfBooking(opts: any) { notifyCalls.tourGuest.push(opts); return ok; }
export async function notifyCheckoutConfirmed(opts: any) { notifyCalls.checkout.push(opts); return ok; }
export async function notifyCheckoutCandidate(opts: any) { notifyCalls.checkoutCandidate.push(opts); return ok; }
export function getNotifier() { return { name: 'stub', sendAlimtalk: async () => ok, sendSms: async () => ok }; }
export const TEMPLATES: Record<string, string> = {};
