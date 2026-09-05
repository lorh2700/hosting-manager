import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiClient, propertyScopeFilter } from '@/lib/api-auth';
import {
  cleaningPatchSchema,
  serializeCleaning,
  zodIssuesToDetails,
} from '@/lib/v1-schemas';
import { deriveExternalSource } from '../route';
import { notifyCleaningCancelled, type CleaningCancelReason } from '@/lib/notify';

async function findCleaning(id: string, auth: { propertyIds: string[] }) {
  return prisma.cleaning.findFirst({
    where: { id, ...propertyScopeFilter({ ...auth, id: '', name: '', keyPrefix: '', scopes: [] }) },
    include: { cleaner: { select: { name: true, phone: true } } },
  });
}

// GET /api/v1/cleanings/{id}
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiClient(req, { scope: 'cleanings:read' });
  if (auth instanceof Response) return auth;

  const { id } = await ctx.params;
  const row = await findCleaning(id, auth);
  if (!row) return NextResponse.json({ error: 'NotFound' }, { status: 404 });
  return NextResponse.json(serializeCleaning(row));
}

// PATCH /api/v1/cleanings/{id}
// Scope: cleanings:write
//
// 본인이 만든 청소(externalSource = derive(client.name))만 수정 가능. 다른 파트너
// 또는 내부 청소는 403 (cross-tenant write 방지).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiClient(req, { scope: 'cleanings:write' });
  if (auth instanceof Response) return auth;

  const { id } = await ctx.params;
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

  // 소유권 확인 — 다른 파트너/내부 청소는 수정 불가
  const myExternalSource = deriveExternalSource(auth);
  if (existing.externalSource !== myExternalSource) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_cleaning' },
      { status: 403 },
    );
  }

  // cleanerId 검증
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

  // status 가 'done' 으로 전환되면 completedAt 자동 세팅
  const completedAtUpdate =
    data.status === 'done' && existing.status !== 'done'
      ? { completedAt: new Date() }
      : data.status === 'pending' && existing.status === 'done'
      ? { completedAt: null }
      : {};

  // 내부 청소매니저가 배정돼 있었는데 파트너가 담당자를 바꾸거나 해제하면 취소 알림.
  const previous = 'cleanerId' in data ? await loadCleanerNotifyInfo(id) : null;

  const updated = await prisma.cleaning.update({
    where: { id },
    data: { ...data, ...completedAtUpdate },
    include: { cleaner: { select: { name: true, phone: true } } },
  });

  if (previous?.cleanerId && previous.cleanerId !== updated.cleanerId) {
    await sendCancelNotice(previous, updated.cleanerId ? 'reassigned' : 'unassigned');
  }

  return NextResponse.json(serializeCleaning(updated));
}

type CleanerNotifyInfo = {
  cleanerId: string | null;
  date: string;
  cleaner: { name: string; phone: string | null } | null;
  property: { name: string } | null;
};

async function loadCleanerNotifyInfo(cleaningId: string): Promise<CleanerNotifyInfo | null> {
  return prisma.cleaning.findUnique({
    where: { id: cleaningId },
    select: {
      cleanerId: true,
      date: true,
      cleaner: { select: { name: true, phone: true } },
      property: { select: { name: true } },
    },
  });
}

async function sendCancelNotice(info: CleanerNotifyInfo, reason: CleaningCancelReason) {
  if (!info.cleanerId || !info.cleaner?.phone) return;
  try {
    const result = await notifyCleaningCancelled({
      cleanerPhone: info.cleaner.phone,
      cleanerName: info.cleaner.name,
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
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiClient(req, { scope: 'cleanings:write' });
  if (auth instanceof Response) return auth;

  const { id } = await ctx.params;
  const existing = await findCleaning(id, auth);
  if (!existing) return NextResponse.json({ error: 'NotFound' }, { status: 404 });

  const myExternalSource = deriveExternalSource(auth);
  if (existing.externalSource !== myExternalSource) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_cleaning' },
      { status: 403 },
    );
  }

  // 삭제 전에 담당자 정보를 확보해 두고, 삭제 후 취소 알림.
  const info = await loadCleanerNotifyInfo(id);
  await prisma.cleaning.delete({ where: { id } });
  if (info) await sendCancelNotice(info, 'deleted');
  return NextResponse.json({ ok: true });
}
