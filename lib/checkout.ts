/**
 * 체크아웃 확인 도메인.
 *
 *  한 숙소·한 날짜의 체크아웃에 여러 신호가 쌓인다: 호스트 확인, 패드 셀프 체크아웃,
 *  (이후) 게스트 답장, 카메라 판정, 문 센서. "확인됨"은 host 또는 guest_pad 신호가 있다는 뜻이고,
 *  확인되는 순간 청소담당자와 호스트에게 알림이 나간다. 같은 종류의 신호는 하루에 한 번만 기록한다.
 */
import { prisma } from '@/lib/prisma';
import { notifyCheckoutConfirmed } from '@/lib/notify';

export type CheckoutSignalKind = 'host' | 'guest_pad' | 'guest_message' | 'camera' | 'sensor';

export const CONFIRMING_KINDS: readonly CheckoutSignalKind[] = ['host', 'guest_pad'];

export const CHECKOUT_KIND_LABEL: Record<CheckoutSignalKind, string> = {
  host: '호스트 확인',
  guest_pad: '게스트 셀프 체크아웃',
  guest_message: '게스트 답장',
  camera: '카메라',
  sensor: '문 센서',
};

export interface CheckoutSignalView {
  kind: CheckoutSignalKind;
  at: string;
  note: string | null;
}

export interface CheckoutStatus {
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedBy: CheckoutSignalKind | null;
  signals: CheckoutSignalView[];
}

const isConfirming = (kind: string) => (CONFIRMING_KINDS as readonly string[]).includes(kind);

function toStatus(rows: { kind: string; at: Date; note: string | null }[]): CheckoutStatus {
  const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = sorted.find(r => isConfirming(r.kind));
  return {
    confirmed: !!first,
    confirmedAt: first ? first.at.toISOString() : null,
    confirmedBy: first ? (first.kind as CheckoutSignalKind) : null,
    signals: sorted.map(r => ({ kind: r.kind as CheckoutSignalKind, at: r.at.toISOString(), note: r.note })),
  };
}

export async function getCheckoutStatus(propertyId: string, date: string): Promise<CheckoutStatus> {
  const rows = await prisma.checkoutSignal.findMany({ where: { propertyId, date }, select: { kind: true, at: true, note: true } });
  return toStatus(rows);
}

/** 여러 숙소의 같은 날짜 상태를 한 번에 (오늘 화면용). 신호가 없는 숙소는 키가 없다. */
export async function checkoutStatusByProperty(propertyIds: string[], date: string): Promise<Record<string, CheckoutStatus>> {
  if (propertyIds.length === 0) return {};
  const rows = await prisma.checkoutSignal.findMany({
    where: { propertyId: { in: propertyIds }, date },
    select: { propertyId: true, kind: true, at: true, note: true },
  });
  const byProp: Record<string, typeof rows> = {};
  for (const r of rows) (byProp[r.propertyId] ??= []).push(r);
  return Object.fromEntries(Object.entries(byProp).map(([pid, list]) => [pid, toStatus(list)]));
}

export interface RecordSignalInput {
  propertyId: string;
  date: string;
  kind: CheckoutSignalKind;
  eventId?: string | null;
  note?: string | null;
}

export interface RecordSignalResult {
  signal: { id: string; kind: string; at: Date };
  /** 같은 종류의 신호가 이미 있어 새로 기록하지 않음 */
  duplicate: boolean;
  /** 이 신호로 처음 "확인됨"이 됨 → 알림 대상 */
  newlyConfirmed: boolean;
}

export async function recordCheckoutSignal(input: RecordSignalInput): Promise<RecordSignalResult> {
  const existing = await prisma.checkoutSignal.findMany({
    where: { propertyId: input.propertyId, date: input.date },
    select: { id: true, kind: true, at: true },
  });
  const same = existing.find(s => s.kind === input.kind);
  if (same) return { signal: same, duplicate: true, newlyConfirmed: false };

  const wasConfirmed = existing.some(s => isConfirming(s.kind));
  const signal = await prisma.checkoutSignal.create({
    data: { propertyId: input.propertyId, date: input.date, kind: input.kind, eventId: input.eventId ?? null, note: input.note ?? null, at: new Date() },
    select: { id: true, kind: true, at: true },
  });
  return { signal, duplicate: false, newlyConfirmed: !wasConfirmed && isConfirming(input.kind) };
}

export function kstTimeText(d: Date): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/**
 * 확인 알림 대상: 그 날짜 청소의 배정 담당자, 없으면 그 숙소를 볼 수 있는 담당자 전원(알림 켠 사람), 그리고 호스트.
 * 전화번호 기준으로 중복 제거. 보낸 건수를 돌려준다.
 */
export async function notifyCheckoutRecipients(opts: {
  propertyId: string;
  date: string;
  kind: CheckoutSignalKind;
  at: Date;
}): Promise<{ notified: number; recipients: string[] }> {
  const property = await prisma.property.findUnique({
    where: { id: opts.propertyId },
    select: { id: true, name: true, ownerId: true, owner: { select: { phone: true, displayName: true, email: true } } },
  });
  if (!property) return { notified: 0, recipients: [] };

  const recipients = new Map<string, string>(); // phone → name

  const cleanings = await prisma.cleaning.findMany({
    where: { propertyId: opts.propertyId, date: opts.date, cleanerId: { not: null } },
    select: { cleaner: { select: { name: true, phone: true } } },
  });
  for (const c of cleanings) if (c.cleaner?.phone) recipients.set(c.cleaner.phone, c.cleaner.name);

  if (recipients.size === 0) {
    const eligible = await prisma.cleaner.findMany({
      where: { ownerId: property.ownerId, notifyNewOpen: true, phone: { not: null } },
      select: { name: true, phone: true, assignments: { select: { propertyId: true } } },
    });
    for (const c of eligible) {
      if (c.assignments.length > 0 && !c.assignments.some(a => a.propertyId === opts.propertyId)) continue;
      if (c.phone) recipients.set(c.phone, c.name);
    }
  }

  // 호스트 본인. 게스트가 직접 눌렀을 때 호스트도 알아야 한다. (호스트가 눌렀으면 본인에겐 안 보냄)
  if (opts.kind !== 'host' && property.owner.phone && !recipients.has(property.owner.phone)) {
    recipients.set(property.owner.phone, property.owner.displayName || property.owner.email || '호스트');
  }

  const by = opts.kind === 'host' ? 'host' : 'guest';
  const timeText = kstTimeText(opts.at);
  let notified = 0;
  await Promise.all(
    [...recipients.entries()].map(async ([phone, name]) => {
      const r = await notifyCheckoutConfirmed({ phone, name, propertyName: property.name, timeText, by });
      if (r?.ok) notified += 1;
    }),
  );
  return { notified, recipients: [...recipients.keys()] };
}
