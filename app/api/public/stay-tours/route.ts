import { withErrors, ok, created, fail } from '@/lib/core/http';
import { listStayTours, submitStayTourInquiry } from '@/lib/payments/tour-selections';
import { rateLimit, clientIp } from '@/lib/rateLimit';

export const GET = withErrors('public/stay-tours', async req => {
  const propertyId = new URL(req.url).searchParams.get('propertyId') ?? '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(propertyId)) throw fail(400, '숙소를 선택해주세요.');
  const response = ok({ tours: await listStayTours(propertyId) });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export const POST = withErrors('public/stay-tours/inquiry', async req => {
  if (!rateLimit(`stay-tour-inquiry:${clientIp(req)}`, 10, 10 * 60_000).ok) throw fail(429, '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.');
  if (Number(req.headers.get('content-length') || 0) > 16_384) throw fail(413, '신청 내용이 너무 깁니다.');
  const reader = req.body?.getReader();
  if (!reader) throw fail(400, '신청 내용을 확인해주세요.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw fail(413, '신청 내용이 너무 깁니다.'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw fail(400, '신청 내용을 확인해주세요.'); }
  const result = await submitStayTourInquiry(body);
  const response = result.replayed ? ok(result) : created(result);
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
