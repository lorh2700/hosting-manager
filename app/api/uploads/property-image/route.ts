import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { withAuth, created, fail, requireManage } from '@/lib/core/http';
import { assertOperationalAccess, propertyAllowsModule } from '@/lib/operational-access';
import { uploadToSupabaseStorage } from '@/lib/supabaseStorage';
import { JongnoImageError, prepareJongnoImage, readJongnoImageBody } from '@/lib/jongno-event-image';

export const runtime = 'nodejs';
export const POST = withAuth('uploads/property-image', async (req, { auth }) => {
  assertOperationalAccess(auth, 'properties');
  const propertyId = new URL(req.url).searchParams.get('propertyId');
  if (!propertyId) throw fail(400, '숙소를 선택해 주세요.');
  requireManage(auth, propertyId);
  const property = await prisma.property.findUnique({ where: { id: propertyId }, include: { organization: { select: { status: true, features: true } } } });
  if (!property) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (auth.role !== 'super_admin' && !propertyAllowsModule(property, 'properties')) throw fail(403, '이 지점의 숙소 관리 기능이 꺼져 있습니다.');
  try {
    const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const image = await prepareJongnoImage(await readJongnoImageBody(req), contentType);
    const uploaded = await uploadToSupabaseStorage({ buffer: image.buffer, contentType: 'image/webp', filename: `property-${propertyId}-${randomUUID()}.webp`, signal: AbortSignal.timeout(15000) });
    if (!uploaded.ok) throw fail(503, '사진 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    return created({ url: uploaded.url, width: image.width, height: image.height, bytes: image.bytes });
  } catch (error) {
    if (error instanceof JongnoImageError) throw fail(400, error.message);
    throw error;
  }
});
