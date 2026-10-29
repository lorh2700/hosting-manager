import { HttpError, fail } from '@/lib/core/errors';
import { authorizeWelcomepadOperation, requireWelcomepadBridge } from '@/lib/welcomepad-data-auth';
import { executeWelcomepadOperation, parseWelcomepadOperation, usesCloudSqlPadData } from '@/lib/welcomepad-data';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(req: Request): Promise<Response> {
  try {
    requireWelcomepadBridge(req);
    if (!usesCloudSqlPadData()) throw fail(503, '패드 데이터 전환이 아직 활성화되지 않았습니다.');
    const reader = req.body?.getReader();
    if (!reader) throw fail(400, '요청 본문이 필요합니다.');
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 768_000) { await reader.cancel(); throw fail(413, '요청 본문이 너무 큽니다.'); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw fail(400, '잘못된 JSON 본문입니다.'); }
    const input = parseWelcomepadOperation(body);
    const actor = await authorizeWelcomepadOperation(req, input);
    return Response.json({ data: await executeWelcomepadOperation(input, actor) }, { headers });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: { code: error.status === 401 ? 'UNAUTHENTICATED' : error.status === 403 ? 'FORBIDDEN' : error.status === 503 ? 'SERVICE_UNAVAILABLE' : 'INVALID_REQUEST', message: error.message } }, { status: error.status, headers });
    console.error('[welcomepad/data] request failed');
    return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: '잠시 후 다시 시도해 주세요.' } }, { status: 503, headers });
  }
}
