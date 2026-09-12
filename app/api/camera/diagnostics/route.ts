import { prisma } from '@/lib/prisma';
import { withAuth, requireManage, requireQuery, ok } from '@/lib/core/http';
export const GET = withAuth('camera/diagnostics', async (req, { auth }) => {
  const propertyId = requireQuery(req, 'propertyId'); requireManage(auth, propertyId);
  const latest = await prisma.cameraSnapshot.findFirst({ where: { propertyId }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true, date: true, verdict: true } });
  const missing = ['CAMERA_IMAP_USER', 'CAMERA_IMAP_PASSWORD', 'OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'].filter(k => !process.env[k]?.trim());
  return ok({ missing, latestCapturedAt: latest?.capturedAt ?? null, latestJudged: !!latest?.verdict, message: missing.length ? '서버 환경변수가 누락되었습니다.' : !latest ? '저장된 사진이 없습니다. 카메라 수신 주소의 +태그, 사진 첨부, 받은편지함 도착 여부와 크론 로그를 확인해 주세요.' : '사진 수신 기록이 있습니다. AI 미판정은 시간대 밖이거나 판정 대기/실패일 수 있습니다.' });
});
