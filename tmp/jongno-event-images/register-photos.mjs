// One-time editorial import. Only the named existing events' image fields change.
import { config } from 'dotenv';
import { Client } from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

config({ path: '.env.local', quiet: true });
const { prepareJongnoImage, jongnoImageFormat } = await import('../../lib/jongno-event-image.ts');
const { uploadToSupabaseStorage } = await import('../../lib/supabaseStorage.ts');
const { parseJongnoEventInput } = await import('../../lib/jongno-events.ts');
const root = new URL('./', import.meta.url);
const sources = JSON.parse(await readFile(new URL('photo-sources.json', root), 'utf8'));
const apply = process.argv.includes('--apply');
const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 6543), database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp', password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000, query_timeout: 15000,
});
const publicResponse = await fetch('http://localhost:3117/api/public/jongno-events?month=2026-10');
if (!publicResponse.ok) throw new Error('Cannot read the existing event records');
const existing = (await publicResponse.json()).events;
const prepared = [];
const applied = [];
try {
  await client.connect();
  for (const source of sources) {
    const event = existing.find(item => item.id === source.id);
    if (!event || event.titleKo !== source.titleKo) throw new Error('Event identity mismatch');
    const row = (await client.query('SELECT version,images FROM jongno_events WHERE id=$1', [source.id])).rows[0];
    if (!row || row.version !== event.version) throw new Error('Event changed since reading');
    if (row.images.length) throw new Error('Event already has images; preserve the existing editorial content');
    const original = new Uint8Array(await readFile(new URL(source.filename, root)));
    // Large licensed archive photos are reduced locally before the normal upload pipeline.
    const bytes = original.length > 8 * 1024 * 1024
      ? new Uint8Array(await sharp(original, { limitInputPixels: 32_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer())
      : original;
    const format = jongnoImageFormat(bytes);
    const contentType = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format];
    if (!contentType) throw new Error('Unsupported image');
    const image = await prepareJongnoImage(bytes, contentType);
    parseJongnoEventInput({ ...event, images: [{ url: source.imageUrl, alt: source.alt, credit: source.credit, sourceUrl: source.sourceUrl }] });
    prepared.push({ source, event, image, originalBytes: original.length });
  }
  if (apply) {
    for (const entry of prepared) {
      const filename = `jongno-${randomUUID()}.webp`;
      const upload = await uploadToSupabaseStorage({ buffer: entry.image.buffer, contentType: 'image/webp', filename, signal: AbortSignal.timeout(20000) });
      if (!upload.ok) throw new Error('Image storage upload failed');
      const check = await fetch(upload.url, { signal: AbortSignal.timeout(15000) });
      if (!check.ok || !(check.headers.get('content-type') || '').startsWith('image/')) throw new Error('Uploaded image is not readable');
      const storedBytes = new Uint8Array(await check.arrayBuffer());
      if (jongnoImageFormat(storedBytes) !== 'webp' || storedBytes.length !== entry.image.bytes) throw new Error('Image verification failed');
      const images = parseJongnoEventInput({ ...entry.event, images: [{ url: upload.url, alt: entry.source.alt, credit: entry.source.credit, sourceUrl: entry.source.sourceUrl }] }).images;
      const result = { id: entry.source.id, titleKo: entry.source.titleKo, images, uploadPath: upload.path, bucket: upload.bucket, bytes: entry.image.bytes, originalBytes: entry.originalBytes, width: entry.image.width, height: entry.image.height, attached: false };
      applied.push(result);
      await writeFile(new URL('photo-import-result.json', root), JSON.stringify(applied, null, 2));
      await client.query('BEGIN');
      try {
        const changed = await client.query("UPDATE jongno_events SET images=$1::jsonb,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND version=$3 AND images='[]'::jsonb RETURNING id,version", [JSON.stringify(images), entry.source.id, entry.event.version]);
        if (changed.rowCount !== 1) throw new Error('Concurrent editor change: no content overwritten');
        await client.query('COMMIT');
        result.attached = true;
        result.version = changed.rows[0].version;
        await writeFile(new URL('photo-import-result.json', root), JSON.stringify(applied, null, 2));
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'validated', events: prepared.map(entry => ({ title: entry.event.titleKo, originalBytes: entry.originalBytes, bytes: entry.image.bytes, width: entry.image.width, height: entry.image.height })), attached: applied.filter(item => item.attached).length }));
} catch (error) {
  console.error('Photo import failed:', error.message);
  process.exitCode = 1;
} finally { await client.end(); }
