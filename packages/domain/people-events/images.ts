import { createHash } from 'node:crypto';
import { fail } from '../../../lib/core/errors';
import { prepareJongnoImage, JongnoImageError } from '../../../lib/jongno-event-image';
import { uploadJongnoImageSchema, PEOPLE_EVENT_IMAGE_BYTES } from '../../contracts/people-events';
import { assertJongnoManagement, type PeopleEventsActor } from './service';

export interface EventImageStorage {
  read(path: string): Promise<Uint8Array | null>;
  create(path: string, bytes: Uint8Array): Promise<'created' | 'exists'>;
  url(path: string): string;
}

export async function validateEventImage(body: unknown) {
  const result = uploadJongnoImageSchema.safeParse(body);
  if (!result.success) throw fail(400, '2MB 이하의 JPEG, PNG, WebP 사진을 선택해 주세요.');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data.data)) throw fail(400, '사진 인코딩을 확인해 주세요.');
  const bytes = Buffer.from(result.data.data, 'base64');
  if (!bytes.length || bytes.length > PEOPLE_EVENT_IMAGE_BYTES) throw fail(413, '사진은 2MB 이하여야 합니다.');
  try { return await prepareJongnoImage(bytes, result.data.mimeType); }
  catch (error) { if (error instanceof JongnoImageError) throw fail(400, error.message); throw error; }
}

export function createEventImageUploader(storage: EventImageStorage) {
  return async (actor: PeopleEventsActor, key: string, body: unknown) => {
    assertJongnoManagement(actor);
    if (!/^[A-Za-z0-9_.:-]{16,200}$/.test(key)) throw fail(400, '유효한 요청 식별키가 필요합니다.');
    const image = await validateEventImage(body);
    const bytes = new Uint8Array(image.buffer);
    const path = `jongno/${createHash('sha256').update(`${actor.user.id}:${key}`).digest('hex')}.webp`;
    const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    const verify = (existing: Uint8Array) => { if (digest(existing) !== digest(bytes)) throw fail(409, '같은 업로드 식별키에 다른 사진을 사용할 수 없습니다.'); };
    const existing = await storage.read(path);
    if (existing) verify(existing);
    else if (await storage.create(path, bytes) === 'exists') {
      const saved = await storage.read(path);
      if (!saved) throw fail(503, '업로드 결과를 확인하지 못했습니다. 같은 사진으로 다시 시도해 주세요.');
      verify(saved);
    }
    return { url: storage.url(path), path, width: image.width, height: image.height, bytes: image.bytes };
  };
}
