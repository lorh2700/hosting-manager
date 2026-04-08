/**
 * 이미지 최적화 스크립트
 * - public/images 내 모든 .jpg/.JPG/.jpeg/.png를 webp로 변환 (최대 1920px, quality 82)
 * - EXIF 방향 자동 보정 (.rotate())
 * - 이미 webp가 존재해도 크기가 원본의 70% 이상이면 재압축
 */
import sharp from 'sharp';
import { readdir, stat } from 'fs/promises';
import { join, extname } from 'path';

const IMAGE_ROOT = new URL('../public/images', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const MAX_WIDTH = 1920;
const QUALITY = 82;

async function getFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function fileSize(p) {
  try { return (await stat(p)).size; } catch { return 0; }
}

async function main() {
  const all = await getFiles(IMAGE_ROOT);
  const sources = all.filter(f => /\.(jpg|jpeg|JPG|png)$/i.test(f));

  console.log(`\n  대상 파일: ${sources.length}개\n`);

  let converted = 0;
  let skipped = 0;

  for (const src of sources) {
    const ext = extname(src);
    const webp = src.slice(0, -ext.length) + '.webp';

    const srcSize = await fileSize(src);
    const webpSize = await fileSize(webp);

    // webp가 이미 존재하고 원본 대비 70% 미만이면 건너뜀
    const needsConvert = webpSize === 0 || webpSize > srcSize * 0.70;

    if (!needsConvert) {
      skipped++;
      continue;
    }

    const label = src.replace(IMAGE_ROOT, '').replace(/\\/g, '/');
    try {
      const meta = await sharp(src).metadata();
      const resize = meta.width && meta.width > MAX_WIDTH
        ? { width: MAX_WIDTH }
        : undefined;

      await sharp(src)
        .rotate() // EXIF 방향 자동 보정
        .resize(resize)
        .webp({ quality: QUALITY })
        .toFile(webp);

      const newSize = await fileSize(webp);
      const saved = (((srcSize - newSize) / srcSize) * 100).toFixed(0);
      console.log(`  ${label}`);
      console.log(`   ${(srcSize / 1024 / 1024).toFixed(1)}MB -> ${(newSize / 1024 / 1024).toFixed(1)}MB (${saved}% 절감)\n`);
      converted++;
    } catch (e) {
      console.error(`  오류: ${label} -- ${e.message}`);
    }
  }

  console.log(`\n완료: ${converted}개 변환, ${skipped}개 스킵\n`);
}

main().catch(console.error);
