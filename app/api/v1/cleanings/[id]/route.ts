import { staffDirectory, eligibleStaff } from '@/lib/staff-directory';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient, propertyScopeFilter, isApiClient } from '@/lib/api-auth';
import { ownsExternalCleaning } from '@/lib/external-cleaning-ownership';
import { externalCleaningTransaction, requireExternalCleaningProperty, recordExternalCleaningAudit } from '@/lib/external-cleaning-commands';
import { withErrors, fail } from '@/lib/core/http';
import type { Prisma } from '@/generated/prisma/client';
import {
  cleaningPatchSchema,
  serializeCleaning,
  zodIssuesToDetails,
} from '@/lib/v1-schemas';
import { notifyCleaningCancelled, type CleaningCancelReason } from '@/lib/notify';

async function findCleaning(id: string, auth: { propertyIds: string[] }) {
  return prisma.cleaning.findFirst({
    where: { id, ...propertyScopeFilter({ ...auth, id: '', name: '', keyPrefix: '', scopes: [] }) },
    include: { cleaner: { select: { displayName: true, phone: true } } },
  });
}

// GET /api/v1/cleanings/{id}
export const GET = withErrors<{ id: string }>('v1/cleanings/id', async (req, { params }) => {
  const auth = await requireApiClient(req, { scope: 'cleanings:read' });
  if (!isApiClient(auth)) return auth;

  const { id } = params;
  const row = await findCleaning(id, auth);
  if (!row) return NextResponse.json({ error: 'NotFound' }, { status: 404 });
  return NextResponse.json(serializeCleaning(row));
});

// PATCH /api/v1/cleanings/{id}
// Scope: cleanings:write
//
// 본인이 만든 청소(externalSource = derive(client.name))만 수정 가능. 다른 파트너
// 또는 내부 청소는 403 (cross-tenant write 방지).
export const PATCH = withErrors<{ id: string }>('v1/cleanings/update', async (req, { params }) => {
  const auth = await requireApiClient(req, { scope: 'cleanings:write' });
  if (!isApiClient(auth)) return auth;

  const { id } = params;
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'BadRequest', code: 'invalid_json' }, { status: 400 }); }

  const parsed = cleaningPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BadRequest', code: 'invalid_body', details: zodIssuesToDetails(parsed.error) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await findCleaning(id, auth);
  if (!existing) return NextResponse.json({ error: 'NotFound' }, { status: 404 });

  // Ownership follows the client identity, not its display name.
  if (!await ownsExternalCleaning(auth, existing)) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_cleaning' },
      { status: 403 },
    );
  }

  // cleanerId 검증
  if (data.cleanerId) {
    const exists = await staffDirectory.findUnique({
      where: { id: data.cleanerId },
      select: { id: true },
    });
    if (!exists || !(await eligibleStaff(existing.propertyId)).some(user => user.id === data.cleanerId)) {
      return NextResponse.json(
        { error: 'BadRequest', code: 'cleaner_not_found' },
        { status: 400 },
      );
    }
  }

  const { updated, previous } = await externalCleaningTransaction(async tx => {
    const current = await tx.cleaning.findUnique({ where: { id } });
    if (!current || !await ownsExternalCleaning(auth, current, tx)) throw fail(403, 'Forbidden', { code: 'not_your_cleaning' });
    const property = await requireExternalCleaningProperty(tx, auth, current.propertyId);
    const completedAtUpdate = data.status === 'done' && current.status !== 'done' ? { completedAt: new Date() }
      : data.status === 'pending' && current.status === 'done' ? { completedAt: null } : {};
    const previous = 'cleanerId' in data ? await loadCleanerNotifyInfo(id, tx) : null;
    const saved = await tx.cleaning.update({ where: { id }, data: { ...data, ...completedAtUpdate },
      include: { cleaner: { select: { displayName: true, phone: true } } } });
    await recordExternalCleaningAudit(tx, auth, property, id, 'external.cleaning.update', req.headers.get('x-request-id'), Object.keys(data));
    return { updated: saved, previous };
  });

  if (previous?.cleanerId && previous.cleanerId !== updated.cleanerId) {
    await sendCancelNotice(previous, updated.cleanerId ? 'reassigned' : 'unassigned');
  }

  return NextResponse.json(serializeCleaning(updated));
});

type CleanerNotifyInfo = {
  cleanerId: string | null;
  date: string;
  cleaner: { displayName: string | null; phone: string | null } | null;
  property: { name: string } | null;
};

async function loadCleanerNotifyInfo(cleaningId: string, reader: Pick<Prisma.TransactionClient, 'cleaning'> = prisma): Promise<CleanerNotifyInfo | null> {
  return reader.cleaning.findUnique({
    where: { id: cleaningId },
    select: {
      cleanerId: true,
      date: true,
      cleaner: { select: { displayName: true, phone: true } },
      property: { select: { name: true } },
    },
  });
}

async function sendCancelNotice(info: CleanerNotifyInfo, reason: CleaningCancelReason) {
  if (!info.cleanerId || !info.cleaner?.phone) return;
  try {
    const result = await notifyCleaningCancelled({
      cleanerPhone: info.cleaner.phone,
      cleanerName: info.cleaner.displayName || '직원',
      propertyName: info.property?.name ?? '숙소',
      date: info.date,
      reason,
    });
    if (result && !result.ok) console.error('[v1/cleanings] cancel notify failed:', result.error);
  } catch (e) {
    console.error('[v1/cleanings] cancel notify error:', e);
  }
}

// DELETE /api/v1/cleanings/{id}
// Scope: cleanings:write — 본인 청소만 삭제 가능.
export const DELETE = withErrors<{ id: string }>('v1/cleanings/delete', async (req, { params }) => {
  const auth = await requireApiClient(req, { scope: 'cleanings:write' });
  if (!isApiClient(auth)) return auth;

  const { id } = params;
  const existing = await findCleaning(id, auth);
  if (!existing) return NextResponse.json({ error: 'NotFound' }, { status: 404 });

  if (!await ownsExternalCleaning(auth, existing)) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_cleaning' },
      { status: 403 },
    );
  }

  // 삭제 전에 담당자 정보를 확보해 두고, 삭제 후 취소 알림.
  const info = await externalCleaningTransaction(async tx => {
    const current = await tx.cleaning.findUnique({ where: { id } });
    if (!current || !await ownsExternalCleaning(auth, current, tx)) throw fail(403, 'Forbidden', { code: 'not_your_cleaning' });
    const property = await requireExternalCleaningProperty(tx, auth, current.propertyId);
    const previous = await loadCleanerNotifyInfo(id, tx);
    await tx.cleaning.delete({ where: { id } });
    await recordExternalCleaningAudit(tx, auth, property, id, 'external.cleaning.delete', req.headers.get('x-request-id'), []);
    return previous;
  });
  if (info) await sendCancelNotice(info, 'deleted');
  return NextResponse.json({ ok: true });
});
