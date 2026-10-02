import sharp from 'sharp';

export const JONGNO_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export class JongnoImageError extends Error {}
export function jongnoImageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'png';
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP') return 'webp';
  return null;
}
/** Never trust a filename or MIME header for public uploads. Decode then rebuild pixels. */
export async function prepareJongnoImage(bytes: Uint8Array, contentType: string) {
  if (!bytes.length || bytes.length > JONGNO_IMAGE_MAX_BYTES) throw new JongnoImageError('사진은 8MB 이하의 파일을 선택해주세요.');
  const format = jongnoImageFormat(bytes), expected = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
  if (!format || !expected || expected !== format) throw new JongnoImageError('JPEG, PNG, WebP 사진 파일만 등록할 수 있습니다.');
  try {
    const decoder = sharp(bytes, { limitInputPixels: 32_000_000, failOn: 'error', animated: false });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.format !== format || (metadata.pages ?? 1) > 1) throw new Error('unsupported image');
    const result = await decoder.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 }).toBuffer({ resolveWithObject: true });
    // Re-encoding discards EXIF/GPS and keeps large poster/photo uploads small.
    return { buffer: Uint8Array.from(result.data).buffer, width: result.info.width, height: result.info.height, bytes: result.data.byteLength };
  } catch {
    throw new JongnoImageError('사진 파일을 읽을 수 없습니다. 다른 JPEG, PNG, WebP 파일을 선택해주세요.');
  }
}
export async function readJongnoImageBody(req: Request): Promise<Uint8Array> {
  const declared = req.headers.get('content-length');
  if (declared && Number(declared) > JONGNO_IMAGE_MAX_BYTES) throw new JongnoImageError('사진은 8MB 이하의 파일을 선택해주세요.');
  if (!req.body) throw new JongnoImageError('사진 파일이 비어 있습니다.');
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > JONGNO_IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new JongnoImageError('사진은 8MB 이하의 파일을 선택해주세요.');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
