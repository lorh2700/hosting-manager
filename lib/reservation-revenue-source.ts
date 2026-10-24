import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

type RevenueDatabase = Pick<Prisma.TransactionClient, '$queryRaw'>;
export interface ReservationRevenueSource {
  canonicalKey: string; checkIn: string; checkOut: string;
  status: 'confirmed' | 'cancelled' | 'pending' | 'noshow';
  currency: string | null; totalMinor: number | null; source: 'beds24'; sourceChannel: string;
  sourceHash: string; sourceModifiedAt: string | null; observedAt: string;
}
export interface RevenueSourceContext { propertyId: string; organizationId: string; beds24PropertyId: string; observedAt: Date }
export interface RevenueSourceResult { saved: number; skipped: number; warning?: string }

function day(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const text = value.slice(0, 10), time = Date.parse(`${text}T00:00:00Z`);
  return text >= '2000-01-01' && text <= '2099-12-31' && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : null;
}
function identifier(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  return /^[1-9]\d{0,19}$/.test(text) ? text : null;
}
function amount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000 ? value : null;
  if (typeof value !== 'string' || !/^\d+(?:\.0+)?$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000_000_000 ? parsed : null;
}
function modified(value: unknown): string | null {
  // A timezone-less provider value is not safely comparable to an absolute observation time.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function readRevenueSourceCurrency(payload: unknown, propertyId: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as { success?: unknown; data?: unknown };
  if (value.success === false || !Array.isArray(value.data)) return null;
  const matches = value.data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item) && identifier(item.id) === propertyId);
  return matches.length === 1 && typeof matches[0].currency === 'string' && /^[A-Z]{3}$/.test(matches[0].currency) ? matches[0].currency : null;
}
export function prepareBeds24RevenueSource(context: RevenueSourceContext, booking: Record<string, unknown>, currency: string | null): ReservationRevenueSource | null {
  const id = identifier(booking.id), checkIn = day(booking.arrival), checkOut = day(booking.departure);
  if (!id || !checkIn || !checkOut || checkOut <= checkIn || !Number.isFinite(context.observedAt.getTime()) ||
    (booking.propertyId !== undefined && identifier(booking.propertyId) !== context.beds24PropertyId)) return null;
  const rawStatus = typeof booking.status === 'string' ? booking.status.toLowerCase().trim() : '';
  const status: ReservationRevenueSource['status'] = ['confirmed', 'new'].includes(rawStatus) ? 'confirmed' : ['cancelled', 'canceled'].includes(rawStatus) ? 'cancelled' : ['noshow', 'no-show', 'no_show'].includes(rawStatus) ? 'noshow' : 'pending';
  const validCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
  const channel = typeof booking.channel === 'string' && booking.channel.trim() ? booking.channel : typeof booking.referer === 'string' ? booking.referer : '';
  const sourceChannel = channel.trim().slice(0, 80) || 'unknown';
  const content = { checkIn, checkOut, status, currency: validCurrency, totalMinor: validCurrency === 'KRW' ? amount(booking.price) : null, source: 'beds24' as const, sourceChannel };
  return { canonicalKey: `legacy-beds24:${context.propertyId}:${id}`, ...content,
    sourceHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), sourceModifiedAt: modified(booking.modified), observedAt: context.observedAt.toISOString() };
}

export async function persistBeds24RevenueSources(db: RevenueDatabase, context: RevenueSourceContext, rows: ReservationRevenueSource[]): Promise<number> {
  if (!rows.length) return 0;
  const [result] = await db.$queryRaw<Array<{ saved: number }>>`
    WITH current_property AS MATERIALIZED (
      SELECT id,organization_id FROM properties WHERE id=${context.propertyId} AND organization_id=${context.organizationId}
        AND beds24_prop_id=${context.beds24PropertyId} FOR SHARE
    ), changed AS (
      INSERT INTO reservation_revenue_sources(organization_id,property_id,canonical_key,check_in,check_out,status,currency,total_minor,source,source_channel,source_hash,source_modified_at,observed_at)
      SELECT p.organization_id,p.id,x."canonicalKey",x."checkIn",x."checkOut",x.status,x.currency,x."totalMinor",x.source,x."sourceChannel",x."sourceHash",x."sourceModifiedAt",x."observedAt"
      FROM current_property p CROSS JOIN jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x("canonicalKey" text,"checkIn" text,"checkOut" text,status text,currency text,"totalMinor" bigint,source text,"sourceChannel" text,"sourceHash" text,"sourceModifiedAt" timestamptz,"observedAt" timestamptz)
      ON CONFLICT(property_id,canonical_key) DO UPDATE SET check_in=EXCLUDED.check_in,check_out=EXCLUDED.check_out,status=EXCLUDED.status,
        currency=EXCLUDED.currency,total_minor=EXCLUDED.total_minor,source_channel=EXCLUDED.source_channel,source_hash=EXCLUDED.source_hash,
        source_modified_at=EXCLUDED.source_modified_at,observed_at=EXCLUDED.observed_at
      WHERE reservation_revenue_sources.organization_id=EXCLUDED.organization_id AND reservation_revenue_sources.source='beds24' AND (
        CASE WHEN reservation_revenue_sources.source_modified_at IS NOT NULL AND EXCLUDED.source_modified_at IS NOT NULL
          THEN EXCLUDED.source_modified_at>reservation_revenue_sources.source_modified_at OR (EXCLUDED.source_modified_at=reservation_revenue_sources.source_modified_at AND EXCLUDED.observed_at>=reservation_revenue_sources.observed_at)
          WHEN reservation_revenue_sources.source_modified_at IS NOT NULL THEN FALSE
          WHEN EXCLUDED.source_modified_at IS NOT NULL THEN TRUE
          ELSE EXCLUDED.observed_at>=reservation_revenue_sources.observed_at END)
      RETURNING 1
    ) SELECT count(*)::int AS saved FROM changed`;
  return result.saved;
}

function migrationMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const item = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
  return item.code === '42P01' || item.code === 'P2021' || item.meta?.code === '42P01' || (!!item.cause && item.cause !== error && migrationMissing(item.cause));
}
export async function collectBeds24RevenueSources(options: {
  db: RevenueDatabase; context: RevenueSourceContext; bookings: Record<string, unknown>[];
  readProperty: () => Promise<unknown>;
}): Promise<RevenueSourceResult> {
  let currency: string | null = null, currencyFailed = false;
  try { currency = readRevenueSourceCurrency(await options.readProperty(), options.context.beds24PropertyId); currencyFailed = currency === null; }
  catch { currencyFailed = true; }
  if (currencyFailed) return { saved: 0, skipped: options.bookings.length, warning: '예약 통화를 확인하지 못해 금액 수집을 건너뛰었습니다. 기존 금액은 갱신되지 않았습니다.' };
  const rows = new Map<string, ReservationRevenueSource>(), ambiguous = new Set<string>(); let skipped = 0;
  for (const booking of options.bookings) {
    const row = prepareBeds24RevenueSource(options.context, booking, currency);
    if (!row) { skipped++; continue; }
    const previous = rows.get(row.canonicalKey);
    if (previous && previous.sourceHash !== row.sourceHash) {
      if (!previous.sourceModifiedAt || !row.sourceModifiedAt || previous.sourceModifiedAt === row.sourceModifiedAt) { ambiguous.add(row.canonicalKey); continue; }
      if (row.sourceModifiedAt < previous.sourceModifiedAt) continue;
    }
    rows.set(row.canonicalKey, row);
  }
  for (const key of ambiguous) { rows.delete(key); skipped++; }
  const prepared = [...rows.values()]; let saved = 0;
  try {
    for (let index = 0; index < prepared.length; index += 250) saved += await persistBeds24RevenueSources(options.db, options.context, prepared.slice(index, index + 250));
  } catch (error) {
    return { saved, skipped: skipped + prepared.length - saved, warning: migrationMissing(error) ? '예약 금액 수집용 DB 업데이트가 필요합니다.' : '예약 금액 수집을 완료하지 못했습니다.' };
  }
  return { saved, skipped: skipped + prepared.length - saved,
    ...(skipped || saved < prepared.length ? { warning: '일부 예약 금액은 원본 변경 또는 사업자 귀속을 확인해야 합니다.' } : {}) };
}
