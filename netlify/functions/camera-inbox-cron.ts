import type { Config } from '@netlify/functions';

/**
 * 5분마다 카메라 메일함 폴링을 시작한다. 실제 작업은 백그라운드 함수(15분 한도)가 한다 —
 * 예약 함수 자체는 30초 한도라 IMAP 접속 + AI 판정을 직접 하지 않는다.
 */
const handler = async () => {
  const baseUrl = process.env.URL || process.env.DEPLOY_URL;
  if (!baseUrl) {
    console.error('[camera-inbox-cron] Missing URL env');
    return new Response('Missing URL', { status: 500 });
  }
  try {
    const res = await fetch(`${baseUrl}/.netlify/functions/camera-inbox-background`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    console.log(`[camera-inbox-cron] background trigger -> ${res.status}`);
    return new Response('Triggered', { status: 200 });
  } catch (err) {
    console.error('[camera-inbox-cron] trigger failed:', err);
    return new Response(String(err), { status: 500 });
  }
};

export default handler;

export const config: Config = {
  schedule: '*/5 * * * *',
};
