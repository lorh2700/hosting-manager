import { withAuth, created, fail } from '@/lib/core/http';
import { uploadToSupabaseStorage } from '@/lib/supabaseStorage';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const runtime = 'nodejs';

// 파일 바이트를 본문으로 직접 받는다 (Next 15 + Turbopack 의 multipart 파싱 문제 회피).
// 클라이언트는 x-filename 과 원본 Content-Type 헤더를 함께 보낸다.
export const POST = withAuth('uploads/tour-image', async (req) => {
  const contentType = req.headers.get('content-type') || 'application/octet-stream';
  if (!ALLOWED.includes(contentType)) throw fail(400, `JPEG/PNG/WEBP/GIF 만 업로드 가능합니다. (받은 형식: ${contentType})`);

  const filenameHeader = req.headers.get('x-filename');
  const filename = filenameHeader ? decodeURIComponent(filenameHeader) : `image.${contentType.split('/')[1] ?? 'bin'}`;

  let buffer: ArrayBuffer;
  try {
    buffer = await req.arrayBuffer();
  } catch (err) {
    console.error('[uploads/tour-image] body read error:', err);
    throw fail(400, '업로드 본문을 읽지 못했습니다. 파일 선택 후 다시 시도해주세요.', { detail: err instanceof Error ? err.message : String(err) });
  }
  if (buffer.byteLength === 0) throw fail(400, '빈 파일입니다.');
  if (buffer.byteLength > MAX_BYTES) throw fail(400, `파일 크기는 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 이하여야 합니다.`);

  const result = await uploadToSupabaseStorage({ buffer, contentType, filename });
  if (!result.ok) throw fail(500, result.error);
  return created({ url: result.url, path: result.path });
});
