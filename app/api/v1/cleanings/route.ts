import { staffDirectory, eligibleStaff } from '@/lib/staff-directory';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient, propertyScopeFilter, isApiClient } from '@/lib/api-auth';
import { deriveExternalSource, legacyExternalSource, ownsExternalCleaning } from '@/lib/external-cleaning-ownership';
import { externalCleaningTransaction, requireExternalCleaningProperty, recordExternalCleaningAudit } from '@/lib/external-cleaning-commands';
import { withErrors, fail } from '@/lib/core/http';
import {
  cleaningsQuerySchema,
  cleaningCreateSchema,
  serializeCleaning,
  zodIssuesToDetails,
} from '@/lib/v1-schemas';

// Each client owns its stable namespace. Older labels require an unambiguous owner.
// GET /api/v1/cleanings
// Scope: cleanings:read
export const GET = withErrors('v1/cleanings', async (req) => {
  const auth = await requireApiClient(req, { scope: 'cleanings:read' });
  if (!isApiClient(auth)) return auth;

  const url = new URL(req.url);
  const parsed = cleaningsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BadRequest', code: 'invalid_query', details: zodIssuesToDetails(parsed.error) },
      { status: 400 },
    );
  }
  const q = parsed.data;

  const clientScope = propertyScopeFilter(auth);
  const propertyFilter = q.propertyId
    ? clientScope.propertyId
      ? { propertyId: { in: clientScope.propertyId.in.filter((id) => id === q.propertyId) } }
      : { propertyId: q.propertyId }
    : clientScope;

  const cleanings = await prisma.cleaning.findMany({
    where: {
      ...propertyFilter,
      ...(q.status ? { status: q.status } : {}),
      ...(q.externalSource ? { externalSource: q.externalSource } : {}),
      ...(q.from || q.to
        ? { date: { gte: q.from, lte: q.to } }
        : {}),
    },
    include: { cleaner: { select: { displayName: true, phone: true } } },
    orderBy: { date: 'asc' },
    take: q.limit,
  });

  return NextResponse.json(
    { items: cleanings.map(serializeCleaning) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});

// POST /api/v1/cleanings
// Scope: cleanings:write
//
// 멱등성: (externalSource = client 이름 derived, externalId = body 명시) 쌍이 이미
// 있으면 update 후 200 반환. 처음이면 (propertyId, date) 슬롯이 다른 source/내부
// 청소로 점유돼 있는지 확인 — 점유돼 있으면 409 first-write-wins.
export const POST = withErrors('v1/cleanings/create', async (req) => {
  const auth = await requireApiClient(req, { scope: 'cleanings:write' });
  if (!isApiClient(auth)) return auth;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'BadRequest', code: 'invalid_json' }, { status: 400 }); }

  const parsed = cleaningCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BadRequest', code: 'invalid_body', details: zodIssuesToDetails(parsed.error) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // 지점 권한 확인
  if (!auth.propertyIds.includes(data.propertyId)) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'property_out_of_scope' },
      { status: 403 },
    );
  }

  // cleanerId 검증 (내부 풀 사용 시)
  if (data.cleanerId) {
    const exists = await staffDirectory.findUnique({
      where: { id: data.cleanerId },
      select: { id: true },
    });
    if (!exists || !(await eligibleStaff(data.propertyId)).some(user => user.id === data.cleanerId)) {
      return NextResponse.json(
        { error: 'BadRequest', code: 'cleaner_not_found' },
        { status: 400 },
      );
    }
  }

  return externalCleaningTransaction(async tx => {
    const property = await requireExternalCleaningProperty(tx, auth, data.propertyId);
    const externalSource = deriveExternalSource(auth);
    let existing = await tx.cleaning.findFirst({ where: { externalSource, externalId: data.externalId } });
    if (!existing) {
      const legacy = await tx.cleaning.findFirst({ where: { externalSource: legacyExternalSource(auth), externalId: data.externalId } });
      if (legacy && await ownsExternalCleaning(auth, legacy, tx)) existing = legacy;
      else if (legacy?.propertyId === data.propertyId) throw fail(409, '기존 외부 청소의 소유권 확인이 필요합니다.', { code: 'legacy_source_ambiguous' });
    }
    if (existing && existing.propertyId !== data.propertyId) {
      throw fail(409, '외부 청소 ID를 다른 숙소로 이동할 수 없습니다.', { code: 'external_id_property_mismatch' });
    }
    const slot = await tx.cleaning.findFirst({ where: { propertyId: data.propertyId, date: data.date, ...(existing ? { id: { not: existing.id } } : {}) } });
    if (slot) throw fail(409, '해당 날짜에 청소 일정이 이미 있습니다.', { code: 'slot_already_claimed' });
    const values = { date: data.date, cleanerId: data.cleanerId ?? null,
      externalCleanerName: data.externalCleanerName ?? null, externalCleanerPhone: data.externalCleanerPhone ?? null,
      status: data.status, supplies: data.supplies ?? null, notes: data.notes ?? null,
      completedAt: data.status === 'done' ? existing?.completedAt ?? new Date() : null,
    };
    const saved = existing ? await tx.cleaning.update({ where: { id: existing.id }, data: values,
      include: { cleaner: { select: { displayName: true, phone: true } } } })
      : await tx.cleaning.create({ data: { ...values, propertyId: data.propertyId, externalSource,
        externalId: data.externalId, assignmentType: 'external', origin: 'external' },
      include: { cleaner: { select: { displayName: true, phone: true } } } });
    await recordExternalCleaningAudit(tx, auth, property, saved.id, existing ? 'external.cleaning.update' : 'external.cleaning.create',
      req.headers.get('x-request-id'), Object.keys(data).filter(key => !['externalId', 'propertyId'].includes(key)));
    return NextResponse.json(serializeCleaning(saved), { status: existing ? 200 : 201 });
  });
});
