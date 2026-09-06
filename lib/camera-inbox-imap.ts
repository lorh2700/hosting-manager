/**
 * 카메라 메일함(IMAP) 폴링. Reolink 카메라가 사람 감지 때 보낸 메일의 사진을 꺼내 파이프라인에 넣는다.
 *
 *  env: CAMERA_IMAP_USER, CAMERA_IMAP_PASSWORD (Gmail 앱 비밀번호), CAMERA_IMAP_HOST(기본 imap.gmail.com), CAMERA_IMAP_PORT(993)
 *  - 읽지 않은 메일만 가져오고, 처리한 메일은 읽음 표시한다 (실패한 메일은 읽지 않은 채로 남겨 다음 폴링에서 재시도).
 *  - 한 번에 최대 MAX_PER_RUN 통 — 크론 30초 안에 끝나도록.
 */
import { ImapFlow } from 'imapflow';
import PostalMime from 'postal-mime';
import { ingestCameraImage, type IngestResult } from '@/lib/camera-ingest';
import type { IncomingCameraImage } from '@/lib/camera-types';

const MAX_PER_RUN = 15;

export interface InboxPollSummary {
  configured: boolean;
  checked: number;
  images: number;
  results: IngestResult[];
  errors: string[];
}

function imapConfig() {
  const user = process.env.CAMERA_IMAP_USER?.trim();
  const pass = process.env.CAMERA_IMAP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) return null;
  return {
    host: process.env.CAMERA_IMAP_HOST?.trim() || 'imap.gmail.com',
    port: Number(process.env.CAMERA_IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false as const,
  };
}

function toArrayBuffer(content: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (typeof content === 'string') return new TextEncoder().encode(content).buffer as ArrayBuffer;
  if (content instanceof ArrayBuffer) return content;
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}

export async function pollCameraInbox(ingest: typeof ingestCameraImage = ingestCameraImage): Promise<InboxPollSummary> {
  const cfg = imapConfig();
  const summary: InboxPollSummary = { configured: !!cfg, checked: 0, images: 0, results: [], errors: [] };
  if (!cfg) return summary;

  const client = new ImapFlow(cfg);
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids.slice(-MAX_PER_RUN)) {
      summary.checked += 1;
      try {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await PostalMime.parse(msg.source);
        const capturedAt = parsed.date ? new Date(parsed.date) : (msg.envelope?.date ?? new Date());
        const to = [...(parsed.to ?? []), ...(parsed.cc ?? [])].map(a => a.address ?? '').filter(Boolean);
        const images = parsed.attachments.filter(a => (a.mimeType || '').startsWith('image/'));
        for (const att of images) {
          const img: IncomingCameraImage = {
            source: 'imap',
            messageId: parsed.messageId ? `${parsed.messageId}#${att.filename ?? images.indexOf(att)}` : null,
            capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
            to,
            from: parsed.from?.address ?? null,
            subject: parsed.subject ?? null,
            text: parsed.text ?? null,
            filename: att.filename || 'snapshot.jpg',
            contentType: att.mimeType || 'image/jpeg',
            buffer: toArrayBuffer(att.content),
          };
          summary.images += 1;
          summary.results.push(await ingest(img));
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push(`uid ${uid}: ${message}`);
        console.error('[camera-inbox] message failed', uid, message);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => null);
  }
  return summary;
}
