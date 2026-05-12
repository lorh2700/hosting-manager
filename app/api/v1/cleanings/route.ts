import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient, propertyScopeFilter, type ApiClient } from '@/lib/api-auth';
import {
  cleaningsQuerySchema,
  cleaningCreateSchema,
  serializeCleaning,
  zodIssuesToDetails,
} from '@/lib/v1-schemas';

// 외부 파트너의 client.name (e.g. "Stayfolio Korea") → externalSource 식별자.
// 같은 파트너의 모든 키는 같은 externalSource 를 발생시키도록 첫 단어를 소문자화.
export function deriveExternalSource(client: ApiClient): string {
  return client.name.toLowerCase().split(/\s+/)[0] || 'partner';
}

// GET /api/v1/cleanings
// Scope: cleanings:read
export async function GET(req: Request) {
  const auth = await requireApiClient(req, { scope: 'cleanings:read' });
  if (auth instanceof Response) return auth;

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
    include: { cleaner: { select: { name: true, phone: true } } },
    orderBy: { date: 'asc' },
    take: q.limit,
  });

  return NextResponse.json(
    { items: cleanings.map(serializeCleaning) },
    { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } },
  );
}

// POST /api/v1/cleanings
// Scope: cleanings:write
//
// 멱등성: (externalSource = client 이름 derived, externalId = body 명시) 쌍이 이미
// 있으면 update 후 200 반환. 처음이면 (propertyId, date) 슬롯이 다른 source/내부
// 청소로 점유돼 있는지 확인 — 점유돼 있으면 409 first-write-wins.
export async function POST(req: Request) {
  const auth = await requireApiClient(req, { scope: 'cleanings:write' });
  if (auth instanceof Response) return auth;

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
  if (auth.propertyIds.length > 0 && !auth.propertyIds.includes(data.propertyId)) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'property_out_of_scope' },
      { status: 403 },
    );
  }

  // cleanerId 검증 (내부 풀 사용 시)
  if (data.cleanerId) {
    const exists = await prisma.cleaner.findUnique({
      where: { id: data.cleanerId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json(
        { error: 'BadRequest', code: 'cleaner_not_found' },
        { status: 400 },
      );
    }
  }

  const externalSource = deriveExternalSource(auth);

  // 멱등성: 동일 (externalSource, externalId) 면 update
  const existing = await prisma.cleaning.findFirst({
    where: { externalSource, externalId: data.externalId },
    include: { cleaner: { select: { name: true, phone: true } } },
  });
  if (existing) {
    const updated = await prisma.cleaning.update({
      where: { id: existing.id },
      data: {
        propertyId: data.propertyId,
        date: data.date,
        cleanerId: data.cleanerId ?? null,
        externalCleanerName: data.externalCleanerName ?? null,
        externalCleanerPhone: data.externalCleanerPhone ?? null,
        status: data.status,
        supplies: data.supplies ?? null,
        notes: data.notes ?? null,
      },
      include: { cleaner: { select: { name: true, phone: true } } },
    });
    return NextResponse.json(serializeCleaning(updated), { status: 200 });
  }

  // First-write-wins 충돌 검사 — 같은 (propertyId, date) 슬롯이 이미 점유?
  const slotConflict = await prisma.cleaning.findFirst({
    where: { propertyId: data.propertyId, date: data.date },
    include: { cleaner: { select: { name: true, phone: true } } },
  });
  if (slotConflict) {
    return NextResponse.json(
      {
        error: 'Conflict',
        code: 'slot_already_claimed',
        existing: serializeCleaning(slotConflict),
      },
      { status: 409 },
    );
  }

  const created = await prisma.cleaning.create({
    data: {
      propertyId: data.propertyId,
      date: data.date,
      cleanerId: data.cleanerId ?? null,
      externalCleanerName: data.externalCleanerName ?? null,
      externalCleanerPhone: data.externalCleanerPhone ?? null,
      externalSource,
      externalId: data.externalId,
      status: data.status,
      supplies: data.supplies ?? null,
      notes: data.notes ?? null,
      assignmentType: 'external',
    },
    include: { cleaner: { select: { name: true, phone: true } } },
  });

  return NextResponse.json(serializeCleaning(created), { status: 201 });
}
