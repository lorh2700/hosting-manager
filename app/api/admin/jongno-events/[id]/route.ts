import { withAuth, ok, readJson, fail } from '@/lib/core/http';
import { getJongnoEvent, readJongnoEventInput, readJongnoEventVersion, updateJongnoEvent } from '@/lib/jongno-events-store';

export const GET = withAuth<{ id: string }>('admin/jongno-events/read', async (_req, { params }) => {
  if (!/^[\w-]{1,100}$/.test(params.id)) throw fail(400, '행사 번호를 확인해주세요.');
  const response = ok({ event: await getJongnoEvent(params.id) });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}, { admin: true });

export const PATCH = withAuth<{ id: string }>('admin/jongno-events/update', async (req, { params }) => {
  if (!/^[\w-]{1,100}$/.test(params.id)) throw fail(400, '행사 번호를 확인해주세요.');
  const body = await readJson(req);
  const input = readJongnoEventInput(body);
  const version = readJongnoEventVersion(body.version);
  return ok({ event: await updateJongnoEvent(params.id, input, version) });
}, { admin: true });
