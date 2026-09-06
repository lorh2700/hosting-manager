/**
 * 카메라 사진 유입 파이프라인 (공급자 무관).
 *   메일(IMAP) / 웹훅 → IncomingCameraImage → 지점 판별 → Storage 저장 → (체크아웃 시간대면) AI 판정
 *   → "퇴실로 보임"이면 체크아웃 신호(camera) 기록 + 호스트 알림. 확정은 호스트가 누른다.
 *
 * 지점 판별 두 가지:
 *   1) 수신 주소의 +태그: cam+byulha@gmail.com → slug 또는 welcomepadKey 가 'byulha' 인 숙소
 *   2) 제목/본문에 숙소 설정의 카메라 이름이 들어 있으면 그 숙소
 */
import { prisma } from '@/lib/prisma';
import { uploadToSupabaseStorage } from '@/lib/supabaseStorage';
import { todayKst } from '@/lib/dates';
import { recordCheckoutSignal, kstTimeText } from '@/lib/checkout';
import { notifyCheckoutCandidate } from '@/lib/notify';
import { judgeCheckoutSnapshot } from '@/lib/checkout-vision';
import { CAMERA_BUCKET, inCheckoutWindow, isLeavingWithLuggage, type CameraVerdict, type IncomingCameraImage } from '@/lib/camera-types';

export { CAMERA_BUCKET };
/** 사진 보관 기간 (개인정보 보호법 표준지침의 30일 기준) */
export const SNAPSHOT_RETENTION_DAYS = 30;
/** 같은 이벤트로 묶어 함께 판정하는 이전 사진 범위 */
const CONTEXT_MINUTES = 10;

export interface IngestDeps {
  upload?: (args: { buffer: ArrayBuffer; contentType: string; filename: string; bucket: string }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  judge?: typeof judgeCheckoutSnapshot;
  notifyHost?: typeof notifyCheckoutCandidate;
  now?: () => Date;
}

export interface IngestResult {
  status: 'stored' | 'duplicate' | 'unmapped' | 'upload_failed';
  snapshotId?: string;
  propertyId?: string;
  judged: boolean;
  leaving: boolean;
  notified: boolean;
  error?: string;
}

type PropertyLite = { id: string; name: string; cameraName: string | null; cameraNotes: string | null; ownerId: string };

function plusTags(addresses: string[]): string[] {
  const tags: string[] = [];
  for (const a of addresses) {
    const m = /\+([a-z0-9._-]+)@/i.exec(a);
    if (m) tags.push(m[1].toLowerCase());
  }
  return tags;
}

export async function resolvePropertyForImage(img: Pick<IncomingCameraImage, 'to' | 'subject' | 'text'>): Promise<PropertyLite | null> {
  const select = { id: true, name: true, cameraName: true, cameraNotes: true, ownerId: true, slug: true, welcomepadKey: true } as const;
  const tags = plusTags(img.to);
  if (tags.length > 0) {
    const all = await prisma.property.findMany({ select });
    const hit = all.find(p => tags.includes((p.slug ?? '').toLowerCase()) || tags.includes((p.welcomepadKey ?? '').toLowerCase()));
    if (hit) return hit;
  }
  const haystack = `${img.subject ?? ''}\n${img.text ?? ''}`.toLowerCase();
  if (haystack.trim()) {
    const named = await prisma.property.findMany({ where: { cameraName: { not: null } }, select });
    const hit = named.find(p => p.cameraName && haystack.includes(p.cameraName.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

/** 오늘 이 숙소에 체크아웃(퇴실 예정)이 있는가 — 없으면 판정 비용을 쓰지 않는다. */
async function hasCheckoutToday(propertyId: string, date: string): Promise<boolean> {
  const [ev, bk, cl] = await Promise.all([
    prisma.event.findFirst({ where: { propertyId, type: 'reservation', endDate: date }, select: { id: true } }),
    prisma.booking.findFirst({ where: { propertyId, status: 'confirmed', checkOut: date }, select: { id: true } }),
    prisma.cleaning.findFirst({ where: { propertyId, date }, select: { id: true } }),
  ]);
  return !!(ev || bk || cl);
}

export async function ingestCameraImage(img: IncomingCameraImage, deps: IngestDeps = {}): Promise<IngestResult> {
  const now = deps.now ? deps.now() : new Date();
  const upload = deps.upload ?? (async args => {
    const r = await uploadToSupabaseStorage(args);
    return r.ok ? { ok: true as const, path: r.path } : { ok: false as const, error: r.error };
  });
  const judge = deps.judge ?? judgeCheckoutSnapshot;
  const notifyHost = deps.notifyHost ?? notifyCheckoutCandidate;

  if (img.messageId) {
    const dup = await prisma.cameraSnapshot.findUnique({ where: { messageId: img.messageId }, select: { id: true } });
    if (dup) return { status: 'duplicate', snapshotId: dup.id, judged: false, leaving: false, notified: false };
  }

  const property = await resolvePropertyForImage(img);
  if (!property) {
    console.warn('[camera-ingest] no property matched', { to: img.to, subject: img.subject });
    return { status: 'unmapped', judged: false, leaving: false, notified: false };
  }

  const capturedAt = img.capturedAt;
  const date = todayKst(capturedAt);
  const stamp = capturedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ext = img.contentType === 'image/png' ? 'png' : 'jpg';
  const uploaded = await upload({ buffer: img.buffer, contentType: img.contentType, filename: `${property.id}/${date}/${stamp}.${ext}`, bucket: CAMERA_BUCKET });
  if (!uploaded.ok) return { status: 'upload_failed', propertyId: property.id, judged: false, leaving: false, notified: false, error: uploaded.error };

  const snapshot = await prisma.cameraSnapshot.create({
    data: {
      propertyId: property.id,
      capturedAt,
      date,
      source: img.source,
      messageId: img.messageId,
      storagePath: uploaded.path,
      cameraName: property.cameraName,
    },
    select: { id: true },
  });

  // 판정은 체크아웃 시간대 + 오늘 퇴실 예정이 있는 숙소에서만.
  if (!inCheckoutWindow(capturedAt) || !(await hasCheckoutToday(property.id, date))) {
    return { status: 'stored', snapshotId: snapshot.id, propertyId: property.id, judged: false, leaving: false, notified: false };
  }

  const verdict = await judge({
    images: [{ buffer: img.buffer, contentType: img.contentType, capturedAt }],
    propertyName: property.name,
    cameraNotes: property.cameraNotes,
  });
  if (!verdict) return { status: 'stored', snapshotId: snapshot.id, propertyId: property.id, judged: false, leaving: false, notified: false };

  const leaving = isLeavingWithLuggage(verdict);
  await prisma.cameraSnapshot.update({ where: { id: snapshot.id }, data: { verdict: verdict as unknown as object, leaving } });

  let notified = false;
  if (leaving) {
    // 하루 한 번만 신호를 남기고 호스트에게 알린다 (같은 종류 신호는 recordCheckoutSignal 이 중복 처리).
    const rec = await recordCheckoutSignal({ propertyId: property.id, date, kind: 'camera', note: verdict.summary });
    if (!rec.duplicate) {
      const owner = await prisma.user.findUnique({ where: { id: property.ownerId }, select: { phone: true, displayName: true, email: true } });
      const r = await notifyHost({
        phone: owner?.phone ?? null,
        name: owner?.displayName || owner?.email || '호스트',
        propertyName: property.name,
        timeText: kstTimeText(capturedAt),
        summary: verdict.summary,
      });
      notified = !!r?.ok;
    }
  }
  return { status: 'stored', snapshotId: snapshot.id, propertyId: property.id, judged: true, leaving, notified };
}

/** 최근 CONTEXT_MINUTES 안의 같은 숙소 사진 (판정 근거 표시·추후 다중 프레임 판정용). */
export async function recentSnapshots(propertyId: string, before: Date, limit = 4) {
  return prisma.cameraSnapshot.findMany({
    where: { propertyId, capturedAt: { gte: new Date(before.getTime() - CONTEXT_MINUTES * 60_000), lte: before } },
    orderBy: { capturedAt: 'desc' },
    take: limit,
    select: { id: true, capturedAt: true, storagePath: true, leaving: true, verdict: true },
  });
}

export type { CameraVerdict };
