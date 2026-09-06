import { prisma } from '@/lib/prisma';
import { withErrors, ok, fail, cronOrSession, MESSAGES } from '@/lib/core/http';
import { pollCameraInbox } from '@/lib/camera-inbox-imap';
import { CAMERA_BUCKET, SNAPSHOT_RETENTION_DAYS } from '@/lib/camera-ingest';
import { deleteFromSupabaseStorage } from '@/lib/supabaseStorage';

/**
 * 5분마다: 카메라 메일함 폴링 → 사진 저장·판정, 그리고 보관 기간(30일) 지난 사진 삭제.
 * 권한: 크론(x-cron-secret) 또는 관리자 세션 (수동 실행용).
 */
export const POST = withErrors('cron/camera-inbox', async (req, { log }) => {
  const auth = await cronOrSession(req);
  if (auth && auth.role !== 'admin') throw fail(403, MESSAGES.forbidden);

  const started = Date.now();
  const poll = await pollCameraInbox();

  // 보관 기간 지난 사진 정리 (파일 → 행 순서. 파일 삭제가 실패하면 행은 남겨 다음에 다시 시도)
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.cameraSnapshot.findMany({ where: { capturedAt: { lt: cutoff } }, select: { id: true, storagePath: true }, take: 200 });
  let purged = 0;
  if (expired.length > 0) {
    const del = await deleteFromSupabaseStorage({ bucket: CAMERA_BUCKET, paths: expired.map(e => e.storagePath) });
    if (del.ok) {
      await prisma.cameraSnapshot.deleteMany({ where: { id: { in: expired.map(e => e.id) } } });
      purged = expired.length;
    } else {
      log(`retention delete failed: ${del.error}`);
    }
  }

  const stored = poll.results.filter(r => r.status === 'stored').length;
  const leaving = poll.results.filter(r => r.leaving).length;
  log(`checked ${poll.checked} mails, ${poll.images} images, stored ${stored}, leaving ${leaving}, purged ${purged}, ${Date.now() - started}ms`);
  return ok({ configured: poll.configured, checked: poll.checked, images: poll.images, stored, leaving, unmapped: poll.results.filter(r => r.status === 'unmapped').length, errors: poll.errors, purged, durationMs: Date.now() - started });
});
