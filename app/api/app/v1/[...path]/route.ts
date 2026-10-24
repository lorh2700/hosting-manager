import { forwardBackendRequest } from '@/lib/backend-bridge';
import { BACKEND_ROUTES } from '@/packages/contracts/backend-routes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function forward(req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const pathname = path.join('/');
  const allowed = BACKEND_ROUTES.some(route => route.method === req.method && new RegExp(`^${route.path.replace(/:id/g, '[A-Za-z0-9_-]+')}$`).test(pathname));
  if (!allowed) return Response.json({ error: { code: 'NOT_FOUND', message: '요청한 기능을 찾을 수 없습니다.', retryable: false }, meta: { requestId: crypto.randomUUID() } }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  return forwardBackendRequest(req, `/api/app/v1/${pathname}`);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
