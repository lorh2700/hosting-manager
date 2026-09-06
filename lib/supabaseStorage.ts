/**
 * Supabase Storage uploader using the REST API directly (no extra deps).
 *
 * Setup required:
 *  1. In the Supabase dashboard → Storage, create a public bucket
 *     (default name: "tour-images").
 *  2. Add to .env.local:
 *       SUPABASE_URL=https://<project-ref>.supabase.co
 *       SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *     The service role key bypasses RLS — never expose it to the client.
 */

const DEFAULT_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET || 'tour-images').trim();

function deriveSupabaseUrl(): string | null {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/$/, '');
  // Best-effort: derive from DB_USER which on Supabase looks like
  // "postgres.<project-ref>" — gives us the public REST endpoint.
  const dbUser = process.env.DB_USER || '';
  const m = dbUser.match(/^postgres\.([a-z0-9]+)$/i);
  if (m) return `https://${m[1]}.supabase.co`;
  return null;
}

export interface UploadOk {
  ok: true;
  url: string;
  path: string;
  bucket: string;
}
export interface UploadErr {
  ok: false;
  error: string;
}

function looksLikePlaceholder(value: string): boolean {
  // Catches `<...>` style placeholders or absurdly short/empty values.
  if (!value) return true;
  if (value.includes('<') || value.includes('>')) return true;
  if (value.length < 40) return true; // real keys are JWTs, much longer
  return false;
}

export async function uploadToSupabaseStorage(opts: {
  buffer: ArrayBuffer;
  contentType: string;
  filename: string;
  bucket?: string;
}): Promise<UploadOk | UploadErr> {
  const supabaseUrl = deriveSupabaseUrl();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl) {
    return { ok: false, error: '.env.local 에 SUPABASE_URL 을 설정해주세요.' };
  }
  if (looksLikePlaceholder(serviceKey)) {
    return {
      ok: false,
      error:
        'SUPABASE_SERVICE_ROLE_KEY 가 placeholder 텍스트로 보입니다. ' +
        'Supabase Dashboard → Project Settings → API → "service_role (secret)" 의 Reveal 을 눌러 ' +
        '실제 키(eyJhbGciOiJ... 로 시작하는 긴 JWT) 로 교체하고 dev 서버를 재시작하세요.',
    };
  }
  const bucket = opts.bucket || DEFAULT_BUCKET;
  const objectPath = `${Date.now()}-${opts.filename.replace(/[^\w.\-]+/g, '_')}`;

  let res: Response;
  try {
    res = await fetch(
      `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(objectPath)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': opts.contentType,
          'x-upsert': 'true',
        },
        body: opts.buffer,
      },
    );
  } catch (e) {
    return {
      ok: false,
      error:
        '네트워크 오류로 Supabase Storage에 도달하지 못했습니다. ' +
        `URL/키를 확인하세요. (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 && /Bucket not found/i.test(text)) {
      return {
        ok: false,
        error: `버킷 "${bucket}" 을 찾을 수 없습니다. Supabase Dashboard → Storage 에서 같은 이름의 버킷을 만들고 Public 으로 설정하세요.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: `권한 거부 (HTTP ${res.status}). SUPABASE_SERVICE_ROLE_KEY 가 올바른지 확인하세요.`,
      };
    }
    return { ok: false, error: `업로드 실패: HTTP ${res.status} ${text.slice(0, 200)}` };
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(objectPath)}`;
  return { ok: true, url: publicUrl, path: objectPath, bucket };
}

function serviceAuth(): { supabaseUrl: string; serviceKey: string } | null {
  const supabaseUrl = deriveSupabaseUrl();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || looksLikePlaceholder(serviceKey)) return null;
  return { supabaseUrl, serviceKey };
}

/**
 * 비공개 버킷용 서명 URL (기본 1시간). 복도 카메라 사진처럼 공개하면 안 되는 파일을 화면에 보여줄 때 쓴다.
 * 실패하면 null — 호출자는 이미지 없이 그린다.
 */
export async function createSignedUrl(opts: { bucket: string; path: string; expiresInSec?: number }): Promise<string | null> {
  const auth = serviceAuth();
  if (!auth) return null;
  try {
    const res = await fetch(
      `${auth.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(opts.bucket)}/${opts.path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: opts.expiresInSec ?? 3600 }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const signed = data.signedURL ?? data.signedUrl;
    if (!signed) return null;
    return signed.startsWith('http') ? signed : `${auth.supabaseUrl}/storage/v1${signed}`;
  } catch {
    return null;
  }
}

/** 객체 여러 개 삭제 (보관 기간 지난 카메라 사진 정리용). 실패해도 던지지 않는다. */
export async function deleteFromSupabaseStorage(opts: { bucket: string; paths: string[] }): Promise<{ ok: boolean; error?: string }> {
  if (opts.paths.length === 0) return { ok: true };
  const auth = serviceAuth();
  if (!auth) return { ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정' };
  try {
    const res = await fetch(`${auth.supabaseUrl}/storage/v1/object/${encodeURIComponent(opts.bucket)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: opts.paths }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
