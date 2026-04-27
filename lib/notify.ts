import { createHmac, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface AlimtalkMessage {
  to: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface NotifyResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

export interface NotifyProvider {
  readonly name: string;
  sendAlimtalk(msg: AlimtalkMessage): Promise<NotifyResult>;
}

// ────────────────────────────────────────────────────────────────
// Template registry — ids come from env so we don't hard-code
// Solapi template codes after approval.
// ────────────────────────────────────────────────────────────────

export const TEMPLATES = {
  CLEANING_ASSIGNED: process.env.SOLAPI_TPL_CLEANING_ASSIGNED ?? '',
  CLEANING_ASSIGNED_BULK: process.env.SOLAPI_TPL_CLEANING_ASSIGNED_BULK ?? '',
  CLEANING_OPEN_NEW: process.env.SOLAPI_TPL_CLEANING_OPEN_NEW ?? '',
  CLEANING_CANCELLED: process.env.SOLAPI_TPL_CLEANING_CANCELLED ?? '',
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
    });
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
            type: 'ATA',
            kakaoOptions: {
              pfId: this.config.pfId,
              templateId: msg.templateId,
              variables: Object.fromEntries(
                Object.entries(msg.variables).map(([k, v]) => [`#{${k}}`, v])
              ),
            },
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

/**
 * Notify a cleaner that a previously-assigned cleaning has been cancelled
 * (deleted, or reassigned to someone else).
 */
export async function notifyCleaningCancelled(opts: {
  cleanerPhone: string | null;
  cleanerName: string;
  propertyName: string;
  date: string;
  reason?: 'deleted' | 'reassigned';
}): Promise<NotifyResult | null> {
  if (!opts.cleanerPhone) return null;
  if (!TEMPLATES.CLEANING_CANCELLED) {
    console.warn('[notify] SOLAPI_TPL_CLEANING_CANCELLED not set; skipping cancel notify');
    return null;
  }

  const notifier = getNotifier();
  return notifier.sendAlimtalk({
    to: opts.cleanerPhone,
    templateId: TEMPLATES.CLEANING_CANCELLED,
    variables: {
      청소업자명: opts.cleanerName,
      숙소명: opts.propertyName,
      청소일: formatDateKo(opts.date),
    },
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

  const cleaners = await prisma.cleaner.findMany({
    where: {
      ownerId: property.ownerId,
      phone: { not: null },
      publicToken: { not: null },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      publicToken: true,
      user: {
        select: {
          id: true,
          properties: { select: { propertyId: true } },
        },
      },
    },
  });

  const eligible = cleaners.filter(c => {
    // No linked user → unscoped, can apply broadly
    if (!c.user) return true;
    const scoped = c.user.properties.map(p => p.propertyId);
    // No scoping rows → unscoped
    if (scoped.length === 0) return true;
    return scoped.includes(opts.propertyId);
  });

  if (eligible.length === 0) return;

  const sortedDates = [...opts.dates].sort();
  const earliest = sortedDates[0];
  const latest = sortedDates[sortedDates.length - 1];
  const dateRange = earliest === latest
    ? formatDateKo(earliest)
    : `${formatDateKo(earliest)} ~ ${formatDateKo(latest)}`;

  const notifier = getNotifier();
  await Promise.all(eligible.map(c =>
    notifier.sendAlimtalk({
      to: c.phone!,
      templateId: TEMPLATES.CLEANING_OPEN_NEW,
      variables: {
        청소업자명: c.name,
        숙소명: property.name,
        청소일정: dateRange,
        건수: String(sortedDates.length),
        청소업자토큰: c.publicToken!,
      },
    }).catch(err => {
      console.error(`[notify] new-open send failed for cleaner ${c.id}:`, err);
      return null;
    })
  ));
}
