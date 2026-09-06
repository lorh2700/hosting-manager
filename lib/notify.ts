import { createHmac, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface AlimtalkMessage {
  to: string;
  templateId: string;
  variables: Record<string, string>;
  /**
   * Optional plain-text fallback. When provided, SOLAPI auto-falls back
   * to SMS/LMS using this text if the alimtalk delivery fails (e.g., the
   * recipient isn't registered with Kakao or has alimtalk disabled).
   */
  smsText?: string;
}

export interface NotifyResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

export interface SmsMessage {
  to: string;
  text: string;
}

export interface NotifyProvider {
  readonly name: string;
  sendAlimtalk(msg: AlimtalkMessage): Promise<NotifyResult>;
  sendSms(msg: SmsMessage): Promise<NotifyResult>;
}

// ────────────────────────────────────────────────────────────────
// Template registry — ids come from env so we don't hard-code
// Solapi template codes after approval.
// ────────────────────────────────────────────────────────────────

export const TEMPLATES = {
  CLEANING_ASSIGNED: process.env.SOLAPI_TPL_CLEANING_ASSIGNED ?? '',
  CLEANING_ASSIGNED_BULK: process.env.SOLAPI_TPL_CLEANING_ASSIGNED_BULK ?? '',
  CLEANING_OPEN_NEW: process.env.SOLAPI_TPL_CLEANING_OPEN_NEW ?? '',
  // 청소 일정 취소 알림 (배정 삭제·예약 취소·다른 담당자 배정·배정 해제).
  // 승인된 템플릿 코드를 기본값으로 두고, 바꿀 때는 env 로 덮어쓴다.
  CLEANING_CANCELLED: process.env.SOLAPI_TPL_CLEANING_CANCELLED ?? 'KA01TP2604271450581856f06opPxqMq',
  CLEANING_APPLICATION_NEW: process.env.SOLAPI_TPL_CLEANING_APPLICATION_NEW ?? '',
  // 체크아웃 완료 알림 (패드 셀프 체크아웃·호스트 확인 → 청소담당자·호스트). 템플릿 승인 전에는 문자로 나간다.
  CHECKOUT_CONFIRMED: process.env.SOLAPI_TPL_CHECKOUT_CONFIRMED ?? '',
  TOUR_BOOKING_NEW: process.env.SOLAPI_TPL_TOUR_BOOKING_NEW ?? '',
  // Host notification — falls back to TOUR_BOOKING_NEW if a dedicated
  // template isn't registered.
  TOUR_BOOKING_HOST: process.env.SOLAPI_TPL_TOUR_BOOKING_HOST ?? process.env.SOLAPI_TPL_TOUR_BOOKING_NEW ?? '',
  TOUR_BOOKING_GUEST: process.env.SOLAPI_TPL_TOUR_BOOKING_GUEST ?? '',
} as const;

// ────────────────────────────────────────────────────────────────
// Noop (default) — logs only, useful until Solapi creds arrive
// ────────────────────────────────────────────────────────────────

class NoopProvider implements NotifyProvider {
  readonly name = 'noop';
  async sendAlimtalk(msg: AlimtalkMessage): Promise<NotifyResult> {
    console.log('[notify/noop] would send alimtalk', {
      to: msg.to,
      templateId: msg.templateId,
      variables: msg.variables,
      smsText: msg.smsText,
    });
    return { ok: true, provider: this.name };
  }
  async sendSms(msg: SmsMessage): Promise<NotifyResult> {
    console.log('[notify/noop] would send sms', { to: msg.to, text: msg.text });
    return { ok: true, provider: this.name };
  }
}

// ────────────────────────────────────────────────────────────────
// Solapi provider
// Docs: https://developers.solapi.com/references/messages/send
// ────────────────────────────────────────────────────────────────

interface SolapiConfig {
  apiKey: string;
  apiSecret: string;
  pfId: string;
  from: string;
}

class SolapiProvider implements NotifyProvider {
  readonly name = 'solapi';
  private readonly config: SolapiConfig;
  private readonly endpoint = 'https://api.solapi.com';

  constructor(config: SolapiConfig) {
    this.config = config;
  }

  private authHeader(): string {
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', this.config.apiSecret)
      .update(date + salt)
      .digest('hex');
    return `HMAC-SHA256 apiKey=${this.config.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }

  async sendAlimtalk(msg: AlimtalkMessage): Promise<NotifyResult> {
    try {
      const message: Record<string, unknown> = {
        to: msg.to.replace(/-/g, ''),
        from: this.config.from,
        type: 'ATA',
        kakaoOptions: {
          pfId: this.config.pfId,
          templateId: msg.templateId,
          variables: Object.fromEntries(
            Object.entries(msg.variables).map(([k, v]) => [`#{${k}}`, v])
          ),
        },
      };
      // SMS failover — when alimtalk delivery fails, SOLAPI sends this
      // text as SMS (≤90 bytes) or LMS automatically.
      if (msg.smsText) {
        message.text = msg.smsText;
      }
      const res = await fetch(`${this.endpoint}/messages/v4/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader(),
        },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          provider: this.name,
          error: data?.errorMessage || data?.message || `HTTP ${res.status}`,
        };
      }
      return { ok: true, provider: this.name, messageId: data?.messageId };
    } catch (e) {
      return { ok: false, provider: this.name, error: (e as Error).message };
    }
  }

  async sendSms(msg: SmsMessage): Promise<NotifyResult> {
    try {
      const isLong = Buffer.byteLength(msg.text, 'utf8') > 90;
      const res = await fetch(`${this.endpoint}/messages/v4/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader(),
        },
        body: JSON.stringify({
          message: {
            to: msg.to.replace(/-/g, ''),
            from: this.config.from,
            type: isLong ? 'LMS' : 'SMS',
            text: msg.text,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          provider: this.name,
          error: data?.errorMessage || data?.message || `HTTP ${res.status}`,
        };
      }
      return { ok: true, provider: this.name, messageId: data?.messageId };
    } catch (e) {
      return { ok: false, provider: this.name, error: (e as Error).message };
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────

let cached: NotifyProvider | null = null;

export function getNotifier(): NotifyProvider {
  if (cached) return cached;
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const pfId = process.env.SOLAPI_PFID;
  const from = process.env.SOLAPI_FROM;
  if (apiKey && apiSecret && pfId && from) {
    cached = new SolapiProvider({ apiKey, apiSecret, pfId, from });
  } else {
    cached = new NoopProvider();
  }
  return cached;
}

// ────────────────────────────────────────────────────────────────
// Domain-level helpers — callers should use these, not sendAlimtalk
// directly, so business rules (1건 vs 일괄) stay centralized.
// ────────────────────────────────────────────────────────────────

export interface CleaningAssignmentItem {
  propertyName: string;
  date: string;          // YYYY-MM-DD
  checkoutTime?: string; // optional HH:mm
}

export async function notifyCleaningAssigned(opts: {
  cleanerPhone: string | null;
  cleanerName: string;
  cleanerToken: string | null;
  items: CleaningAssignmentItem[];
}): Promise<NotifyResult | null> {
  if (!opts.cleanerPhone || opts.items.length === 0) return null;
  if (!opts.cleanerToken) {
    console.warn('[notify] cleaner has no publicToken; skipping alimtalk');
    return null;
  }

  const notifier = getNotifier();
  const sorted = [...opts.items].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 1) {
    const item = sorted[0];
    if (!TEMPLATES.CLEANING_ASSIGNED) {
      console.warn('[notify] SOLAPI_TPL_CLEANING_ASSIGNED not set; skipping');
      return null;
    }
    return notifier.sendAlimtalk({
      to: opts.cleanerPhone,
      templateId: TEMPLATES.CLEANING_ASSIGNED,
      variables: {
        청소업자명: opts.cleanerName,
        숙소명: item.propertyName,
        청소일: formatDateKo(item.date),
        체크아웃시간: item.checkoutTime ?? '11:00',
        청소업자토큰: opts.cleanerToken,
      },
    });
  }

  if (!TEMPLATES.CLEANING_ASSIGNED_BULK) {
    console.warn('[notify] SOLAPI_TPL_CLEANING_ASSIGNED_BULK not set; skipping');
    return null;
  }
  return notifier.sendAlimtalk({
    to: opts.cleanerPhone,
    templateId: TEMPLATES.CLEANING_ASSIGNED_BULK,
    variables: {
      청소업자명: opts.cleanerName,
      배정건수: String(sorted.length),
      최초청소일: formatDateKo(sorted[0].date),
      최종청소일: formatDateKo(sorted[sorted.length - 1].date),
      청소업자토큰: opts.cleanerToken,
    },
  });
}

export type CleaningCancelReason = 'deleted' | 'reassigned' | 'unassigned';

const CANCEL_REASON_TEXT: Record<CleaningCancelReason, string> = {
  deleted: '예약 취소 등으로 청소 일정이 삭제되었습니다.',
  reassigned: '해당 청소가 다른 담당자에게 배정되었습니다.',
  unassigned: '해당 청소의 배정이 해제되었습니다.',
};

/**
 * Notify a cleaner that a previously-assigned cleaning has been cancelled
 * (deleted, reassigned to someone else, or unassigned).
 *
 * 알림톡(템플릿 CLEANING_CANCELLED)을 먼저 보내고, 수신자가 카카오 미등록이면
 * SOLAPI 가 같은 요청 안의 smsText 로 자동 대체한다. 요청 자체가 거부되면
 * (템플릿 변수 불일치 등) 일반 문자로 한 번 더 보내 알림이 누락되지 않게 한다.
 */
export async function notifyCleaningCancelled(opts: {
  cleanerPhone: string | null;
  cleanerName: string;
  propertyName: string;
  date: string;
  reason?: CleaningCancelReason;
}): Promise<NotifyResult | null> {
  if (!opts.cleanerPhone) return null;

  const reason = opts.reason ?? 'deleted';
  const dateKo = formatDateKo(opts.date);
  const smsText =
    `[void anchae] 청소 일정 취소\n` +
    `${opts.cleanerName}님, ${opts.propertyName} ${dateKo} 청소가 취소되었습니다.\n` +
    `${CANCEL_REASON_TEXT[reason]}`;

  const notifier = getNotifier();

  if (!TEMPLATES.CLEANING_CANCELLED) {
    console.warn('[notify] SOLAPI_TPL_CLEANING_CANCELLED not set; sending plain SMS instead');
    return notifier.sendSms({ to: opts.cleanerPhone, text: smsText }).catch(err => {
      console.error('[notify] cleaning cancel SMS failed', err);
      return null;
    });
  }

  const result = await notifier.sendAlimtalk({
    to: opts.cleanerPhone,
    templateId: TEMPLATES.CLEANING_CANCELLED,
    variables: {
      청소업자명: opts.cleanerName,
      숙소명: opts.propertyName,
      청소일: dateKo,
    },
    smsText,
  }).catch(err => {
    console.error('[notify] cleaning cancel alimtalk threw', err);
    return { ok: false, provider: 'unknown', error: String(err) } as NotifyResult;
  });

  if (result.ok) return result;

  console.warn('[notify] cleaning cancel alimtalk rejected; falling back to SMS', {
    to: opts.cleanerPhone, date: opts.date, reason, error: result.error,
  });
  return notifier.sendSms({ to: opts.cleanerPhone, text: smsText }).catch(err => {
    console.error('[notify] cleaning cancel SMS fallback failed', err);
    return result;
  });
}

/**
 * 체크아웃 완료 알림 — 청소담당자와 호스트에게.
 * 템플릿(SOLAPI_TPL_CHECKOUT_CONFIRMED)이 없으면 문자로, 알림톡이 거부되면 문자로 대체한다.
 * 템플릿 변수: #{수신자명} #{숙소명} #{체크아웃시각} #{확인주체}
 */
export async function notifyCheckoutConfirmed(opts: {
  phone: string | null;
  name: string;
  propertyName: string;
  /** 'HH:mm' (KST) */
  timeText: string;
  by: 'host' | 'guest';
}): Promise<NotifyResult | null> {
  if (!opts.phone) return null;
  const byText = opts.by === 'guest' ? '게스트 직접 확인' : '호스트 확인';
  const smsText =
    `[void anchae] 체크아웃 완료\n` +
    `${opts.propertyName} 게스트가 ${opts.timeText}에 체크아웃했습니다. (${byText})\n` +
    `청소를 시작하실 수 있습니다.`;

  const notifier = getNotifier();

  if (!TEMPLATES.CHECKOUT_CONFIRMED) {
    return notifier.sendSms({ to: opts.phone, text: smsText }).catch(err => {
      console.error('[notify] checkout SMS failed', err);
      return null;
    });
  }

  const result = await notifier.sendAlimtalk({
    to: opts.phone,
    templateId: TEMPLATES.CHECKOUT_CONFIRMED,
    variables: {
      수신자명: opts.name,
      숙소명: opts.propertyName,
      체크아웃시각: opts.timeText,
      확인주체: byText,
    },
    smsText,
  }).catch(err => {
    console.error('[notify] checkout alimtalk threw', err);
    return { ok: false, provider: 'unknown', error: String(err) } as NotifyResult;
  });
  if (result.ok) return result;

  console.warn('[notify] checkout alimtalk rejected; falling back to SMS', { to: opts.phone, error: result.error });
  return notifier.sendSms({ to: opts.phone, text: smsText }).catch(err => {
    console.error('[notify] checkout SMS fallback failed', err);
    return result;
  });
}

/**
 * Notify a tour operator that a new tour booking arrived.
 * Falls back gracefully when channel is email-only / unconfigured —
 * we always log so the host can audit even if no message went out.
 */
export async function notifyTourOperatorOfBooking(opts: {
  operator: {
    id: string;
    name: string;
    contactPhone: string | null;
    email: string | null;
    notifyChannel: string;
    publicToken: string | null;
  } | null;
  tourTitle: string;
  guestName: string;
  guestPhone: string;
  guests: number;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:mm
  durationMin?: number | null;
  totalPrice?: number | null;
  meetingPoint: string | null;
  bookingId: string;
}): Promise<void> {
  const op = opts.operator;
  if (!op) {
    console.log('[notify] tour booking has no operator; skipping forward', { bookingId: opts.bookingId });
    return;
  }
  if (op.notifyChannel === 'none') return;

  const wantKakao = op.notifyChannel === 'kakao' || op.notifyChannel === 'both';
  const wantEmail = op.notifyChannel === 'email' || op.notifyChannel === 'both';

  if (wantKakao && op.contactPhone && TEMPLATES.TOUR_BOOKING_NEW && op.publicToken) {
    const notifier = getNotifier();
    await notifier.sendAlimtalk({
      to: op.contactPhone,
      templateId: TEMPLATES.TOUR_BOOKING_NEW,
      variables: {
        업체명: op.name,
        투어명: opts.tourTitle,
        투어일: formatDateKo(opts.date),
        투어시간: opts.startTime,
        코스시간: opts.durationMin != null ? `${opts.durationMin}분` : '미지정',
        예약자명: opts.guestName,
        예약자연락처: opts.guestPhone,
        예약인원: `${opts.guests}명`,
        총금액: opts.totalPrice != null ? `${opts.totalPrice.toLocaleString()}원` : '미정',
        모임장소: opts.meetingPoint ?? '미지정',
        업체토큰: op.publicToken,
      },
    }).catch(err => {
      console.error('[notify] tour booking alimtalk failed', err);
    });
  } else if (wantKakao) {
    console.log('[notify] kakao requested but missing config — phone/template/token', {
      operatorId: op.id, hasPhone: !!op.contactPhone, hasTemplate: !!TEMPLATES.TOUR_BOOKING_NEW, hasToken: !!op.publicToken,
    });
  }

  if (wantEmail && op.email) {
    // Email forwarding via Formspree (already used elsewhere) — keeps deps minimal.
    const formId = process.env.FORMSPREE_FORM_ID;
    if (formId) {
      try {
        await fetch(`https://formspree.io/f/${formId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            _subject: `[투어 예약] ${opts.tourTitle} — ${opts.guestName}님 (${opts.date} ${opts.startTime})`,
            _replyto: op.email,
            업체명: op.name,
            투어명: opts.tourTitle,
            예약일시: `${opts.date} ${opts.startTime}`,
            코스시간: opts.durationMin != null ? `${opts.durationMin}분` : '미지정',
            예약자: `${opts.guestName} (${opts.guestPhone})`,
            인원: `${opts.guests}명`,
            총금액: opts.totalPrice != null ? `${opts.totalPrice.toLocaleString()}원` : '미정',
            모임장소: opts.meetingPoint ?? '미지정',
          }),
        });
      } catch (err) {
        console.error('[notify] tour booking email failed', err);
      }
    }
  }
}

/**
 * Notify the property HOST when a cleaner applies for one of their open
 * cleanings. Sends alimtalk if the template is registered, otherwise
 * falls back to SMS so the host always hears about it.
 */
export async function notifyHostOfCleaningApplication(opts: {
  hostPhone: string | null;
  hostName: string;
  cleanerName: string;
  propertyName: string;
  date: string; // YYYY-MM-DD
  applicationId: string;
}): Promise<NotifyResult | null> {
  if (!opts.hostPhone) {
    console.log('[notify] host has no phone; skipping application notify', { applicationId: opts.applicationId });
    return null;
  }

  const variables = {
    호스트명: opts.hostName,
    청소담당자명: opts.cleanerName,
    숙소명: opts.propertyName,
    청소일: formatDateKo(opts.date),
  };

  const smsText =
    `[void anchae] 청소 자동 배정\n` +
    `${opts.cleanerName}님이 ${opts.propertyName} ` +
    `${variables.청소일} 청소를 맡았습니다.\n` +
    `캘린더에서 확인하실 수 있습니다.`;

  const notifier = getNotifier();
  const templateId = TEMPLATES.CLEANING_APPLICATION_NEW;

  if (!templateId) {
    console.warn('[notify] SOLAPI_TPL_CLEANING_APPLICATION_NEW not set; sending plain SMS instead');
    return notifier.sendSms({ to: opts.hostPhone, text: smsText }).catch(err => {
      console.error('[notify] application SMS failed', err);
      return null;
    });
  }

  return notifier.sendAlimtalk({
    to: opts.hostPhone,
    templateId,
    variables,
    smsText,
  }).catch(err => {
    console.error('[notify] application alimtalk failed', err);
    return null;
  });
}

/**
 * Notify the tour HOST (the User who created the tour) when a new booking
 * arrives. Independent from operator-side forwarding — covers the case
 * where the host wants to know immediately even if no operator is set,
 * or wants their own copy in addition to the operator's.
 */
export async function notifyTourHostOfBooking(opts: {
  hostPhone: string | null;
  hostName: string;
  tourTitle: string;
  guestName: string;
  guestPhone: string | null;
  guests: number;
  date: string;
  startTime: string;
  durationMin?: number | null;
  totalPrice?: number | null;
  meetingPoint: string | null;
  bookingId: string;
}): Promise<NotifyResult | null> {
  if (!opts.hostPhone) {
    console.log('[notify] tour host has no phone; skipping host notify', { bookingId: opts.bookingId });
    return null;
  }
  const templateId = TEMPLATES.TOUR_BOOKING_HOST;
  if (!templateId) {
    console.warn('[notify] SOLAPI_TPL_TOUR_BOOKING_HOST (or _NEW) not set; skipping host notify');
    return null;
  }

  const notifier = getNotifier();
  return notifier.sendAlimtalk({
    to: opts.hostPhone,
    templateId,
    variables: {
      업체명: opts.hostName,
      투어명: opts.tourTitle,
      투어일: formatDateKo(opts.date),
      투어시간: opts.startTime,
      코스시간: opts.durationMin != null ? `${opts.durationMin}분` : '미지정',
      예약자명: opts.guestName,
      예약자연락처: opts.guestPhone?.trim() || '연락처 미입력',
      예약인원: `${opts.guests}명`,
      총금액: opts.totalPrice != null ? `${opts.totalPrice.toLocaleString()}원` : '미정',
      모임장소: opts.meetingPoint ?? '미지정',
      업체토큰: '',
    },
  }).catch(err => {
    console.error('[notify] tour host alimtalk failed', err);
    return null;
  });
}

/**
 * Notify the guest who made the tour booking, if they provided a phone.
 * Sends KakaoTalk alimtalk, with automatic SMS fallback handled by SOLAPI
 * when the recipient isn't reachable on Kakao.
 *
 * Skips silently when:
 *  - guest didn't provide a phone number
 *  - SOLAPI_TPL_TOUR_BOOKING_GUEST template isn't configured
 */
export async function notifyTourGuestOfBooking(opts: {
  guestPhone: string | null;
  guestName: string;
  tourTitle: string;
  date: string;
  startTime: string;
  durationMin?: number | null;
  totalPrice?: number | null;
  meetingPoint: string | null;
  guests: number;
  bookingId: string;
}): Promise<NotifyResult | null> {
  if (!opts.guestPhone) {
    console.log('[notify] tour guest has no phone; skipping guest notify', { bookingId: opts.bookingId });
    return null;
  }

  const variables = {
    예약자명: opts.guestName,
    투어명: opts.tourTitle,
    투어일: formatDateKo(opts.date),
    투어시간: opts.startTime,
    코스시간: opts.durationMin != null ? `${opts.durationMin}분` : '미지정',
    예약인원: `${opts.guests}명`,
    총금액: opts.totalPrice != null ? `${opts.totalPrice.toLocaleString()}원` : '미정',
    모임장소: opts.meetingPoint ?? '미지정',
  };

  // Plain-text version — used both as SMS failover and as the message
  // when no alimtalk template is configured.
  const smsText =
    `[void anchae 투어 예약 확인]\n` +
    `${opts.guestName}님, 예약이 접수되었습니다.\n\n` +
    `투어: ${opts.tourTitle}\n` +
    `일정: ${variables.투어일} ${opts.startTime}\n` +
    `코스: ${variables.코스시간}\n` +
    `인원: ${variables.예약인원}\n` +
    `금액: ${variables.총금액}\n` +
    `모임: ${variables.모임장소}\n\n` +
    `운영업체 확정 후 다시 안내드립니다.`;

  const templateId = TEMPLATES.TOUR_BOOKING_GUEST;
  const notifier = getNotifier();

  if (!templateId) {
    // No alimtalk template registered → send straight SMS.
    console.warn('[notify] SOLAPI_TPL_TOUR_BOOKING_GUEST not set; sending plain SMS instead');
    return notifier.sendSms({ to: opts.guestPhone, text: smsText }).catch(err => {
      console.error('[notify] tour guest SMS failed', err);
      return null;
    });
  }

  return notifier.sendAlimtalk({
    to: opts.guestPhone,
    templateId,
    variables,
    smsText,
  }).catch(err => {
    console.error('[notify] tour guest alimtalk failed', err);
    return null;
  });
}

function formatDateKo(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  return `${yyyyMmDd} (${weekday})`;
}

/**
 * Notify cleaners that fresh open cleanings are available on a property.
 *
 * Recipients: cleaners owned by the property owner who either have a User
 * account scoped to this property, or have no scoping at all (they can
 * apply broadly — same rule as /api/cleanings GET for cleaners).
 *
 * One alimtalk per cleaner, regardless of how many dates were created on
 * the same property in the same sync.
 */
export async function notifyNewOpenCleanings(opts: {
  propertyId: string;
  dates: string[];
}): Promise<void> {
  if (opts.dates.length === 0) return;
  if (!TEMPLATES.CLEANING_OPEN_NEW) {
    console.warn('[notify] SOLAPI_TPL_CLEANING_OPEN_NEW not set; skipping new-open notify');
    return;
  }

  const property = await prisma.property.findUnique({
    where: { id: opts.propertyId },
    select: { ownerId: true, name: true },
  });
  if (!property) return;

  // 대상 = 소유 호스트의 담당자 중 알림 수신이 켜져 있고, 이 숙소를 볼 수 있는 사람
  // (배정 지점이 없으면 호스트의 모든 숙소 → 대상, 있으면 이 숙소가 포함될 때만).
  const cleaners = await prisma.cleaner.findMany({
    where: {
      ownerId: property.ownerId,
      notifyNewOpen: true,
      phone: { not: null },
      publicToken: { not: null },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      publicToken: true,
      assignments: { select: { propertyId: true } },
    },
  });

  const eligible = cleaners.filter(c =>
    c.assignments.length === 0 || c.assignments.some(a => a.propertyId === opts.propertyId),
  );

  if (eligible.length === 0) return;

  const sortedDates = [...opts.dates].sort();
  const notifier = getNotifier();

  // Solapi 템플릿은 #{청소일}, #{체크아웃시간} 단수 변수를 사용하므로
  // 청소인력 × 날짜 단위로 한 건씩 발송한다.
  await Promise.all(
    eligible.flatMap(c =>
      sortedDates.map(date =>
        notifier.sendAlimtalk({
          to: c.phone!,
          templateId: TEMPLATES.CLEANING_OPEN_NEW,
          variables: {
            청소업자명: c.name,
            숙소명: property.name,
            청소일: formatDateKo(date),
            체크아웃시간: '11:00',
            청소업자토큰: c.publicToken!,
          },
        }).catch(err => {
          console.error(`[notify] new-open send failed for cleaner ${c.id} date ${date}:`, err);
          return null;
        })
      )
    )
  );
}
