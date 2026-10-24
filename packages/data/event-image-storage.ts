import { fail } from '../../lib/core/errors';
import type { EventImageStorage } from '../domain/people-events/images';

export function createEventImageStorage(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): EventImageStorage {
  const inferred = (env.DB_USER || '').match(/^postgres\.([a-z0-9]+)$/i)?.[1];
  const base = (env.SUPABASE_URL || (inferred ? `https://${inferred}.supabase.co` : '')).replace(/\/$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = (env.SUPABASE_STORAGE_BUCKET || 'tour-images').trim();
  const objectUrl = (path: string, publicRead = false) => `${base}/storage/v1/object/${publicRead ? 'public/' : ''}${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  function configuration() { if (!base || !base.startsWith('https://') || key.length < 40 || /[<>]/.test(key) || !bucket) throw fail(503, '행사 사진 저장소 설정을 확인해 주세요.'); }
  return {
    async read(path) {
      configuration();
      try {
        const response = await request(objectUrl(path), { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (response.status === 404) return null;
        if (response.status === 400) { const body = await response.json().catch(() => ({})) as { statusCode?: string; error?: string }; if (body.statusCode === '404' || body.error === 'not_found') return null; }
        if (!response.ok) throw new Error();
        const length = Number(response.headers.get('content-length'));
        if (length > 8 * 1024 * 1024) throw new Error();
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 8 * 1024 * 1024) throw new Error();
        return bytes;
      } catch { throw fail(503, '사진 저장 결과를 확인하지 못했습니다. 같은 사진으로 다시 시도해 주세요.'); }
    },
    async create(path, bytes) {
      configuration();
      try {
        const response = await request(objectUrl(path), { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/webp', 'x-upsert': 'false' },
          body: Uint8Array.from(bytes).buffer, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (response.status === 409) return 'exists';
        if (response.status === 400) { const body = await response.json().catch(() => ({})) as { statusCode?: string; error?: string }; if (body.statusCode === '409' || body.error === 'Duplicate') return 'exists'; }
        if (!response.ok) throw new Error();
        return 'created';
      } catch { throw fail(503, '업로드 결과가 불확실합니다. 같은 사진으로 다시 시도해 주세요.'); }
    },
    url: path => objectUrl(path, true),
  };
}
