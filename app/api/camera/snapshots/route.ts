import { prisma } from '@/lib/prisma';
import { withAuth, ok, fail, requireVisible, requireQuery, query, DATE_RE } from '@/lib/core/http';
import { todayKst } from '@/lib/dates';
import { CAMERA_BUCKET } from '@/lib/camera-types';
import { createSignedUrl } from '@/lib/supabaseStorage';

/**
 * 숙소의 복도 카메라 사진 목록 (하루치). 서명 URL 은 1시간 유효.
 *   GET /api/camera/snapshots?propertyId=…[&date=YYYY-MM-DD]
 */
export const GET = withAuth('camera/snapshots', async (req, { auth }) => {
  const propertyId = requireQuery(req, 'propertyId');
  await requireVisible(auth, propertyId);
  const raw = query(req, 'date');
  const date = raw && DATE_RE.test(raw) ? raw : todayKst();
  if (raw && !DATE_RE.test(raw)) throw fail(400, 'date는 YYYY-MM-DD 형식이어야 합니다.');

  const rows = await prisma.cameraSnapshot.findMany({
    where: { propertyId, date },
    orderBy: { capturedAt: 'desc' },
    take: 200,
    select: { id: true, capturedAt: true, storagePath: true, source: true, leaving: true, verdict: true, cameraName: true },
  });
  const [dates, snapshots] = await Promise.all([
    prisma.cameraSnapshot.findMany({ where: { propertyId }, select: { date: true }, distinct: ['date'], orderBy: { date: 'desc' }, take: 31 }),
    Promise.all(rows.map(async r => ({
      id: r.id,
      capturedAt: r.capturedAt.toISOString(),
      url: await createSignedUrl({ bucket: CAMERA_BUCKET, path: r.storagePath }),
      source: r.source,
      leaving: r.leaving,
      verdict: r.verdict,
      cameraName: r.cameraName,
    }))),
  ]);
  return ok({ propertyId, date, dates: dates.map(d => d.date), snapshots });
});
