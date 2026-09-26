import { prisma } from '@/lib/prisma';
import { withAuth, requireManage, requireQuery, ok } from '@/lib/core/http';
export const GET = withAuth('camera/diagnostics', async (req, { auth }) => {
  const propertyId = requireQuery(req, 'propertyId'); requireManage(auth, propertyId);
  const latest = await prisma.cameraSnapshot.findFirst({ where: { propertyId }, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true, date: true, verdict: true } });
  const missing = ['CAMERA_IMAP_USER', 'CAMERA_IMAP_PASSWORD', 'OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'].filter(k => !process.env[k]?.trim());
  const labels: Record<string, string> = { CAMERA_IMAP_USER: '사진 수신 메일 계정', CAMERA_IMAP_PASSWORD: '사진 수신 메일 연결 비밀번호', OPENAI_API_KEY: 'AI 판정 연결', SUPABASE_URL: '사진 저장소 주소', SUPABASE_SERVICE_ROLE_KEY: '사진 저장소 연결', CRON_SECRET: '자동 수집 연결' };
  const captureMissing = missing.filter(key => key !== 'OPENAI_API_KEY');
  const message = captureMissing.length ? `사진 수집에 필요한 설정이 없습니다: ${captureMissing.map(key => labels[key]).join(', ')}.`
    : !latest ? '저장된 사진이 없습니다. 카메라가 사진 첨부 메일을 보내는지, 받은편지함에 도착하는지, 수신 주소의 +태그 또는 카메라 이름이 숙소와 연결되는지 확인해 주세요.'
    : missing.includes('OPENAI_API_KEY') ? '사진 수신 기록은 있지만 AI 판정 연결이 설정되지 않았습니다. 사진 열람은 가능합니다.'
    : '사진 수신 기록이 있습니다. AI 미판정은 시간대 밖이거나 판정 대기/실패일 수 있습니다.';
  return ok({ missing, missingLabels: missing.map(key => labels[key]), latestCapturedAt: latest?.capturedAt ?? null, latestJudged: !!latest?.verdict, message });
});
