import { randomUUID } from 'node:crypto';
import { withAuth, created, fail } from '@/lib/core/http';
import { uploadToSupabaseStorage } from '@/lib/supabaseStorage';
import { JongnoImageError, prepareJongnoImage, readJongnoImageBody } from '@/lib/jongno-event-image';

export const runtime = 'nodejs';
export const POST = withAuth('uploads/jongno-event-image', async req => {
  try {
    const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const image = await prepareJongnoImage(await readJongnoImageBody(req), contentType);
    const result = await uploadToSupabaseStorage({ buffer: image.buffer, contentType: 'image/webp', filename: `jongno-${randomUUID()}.webp`, signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw fail(503, '사진 저장에 실패했습니다. 저장소 설정을 확인하거나 잠시 후 다시 시도해주세요.');
    return created({ url: result.url, path: result.path, width: image.width, height: image.height, bytes: image.bytes });
  } catch (error) {
    if (error instanceof JongnoImageError) throw fail(400, error.message);
    throw error;
  }
}, { admin: true });
