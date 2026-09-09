/**
 * 카메라 메일함(IMAP) 폴링. Reolink 카메라가 사람 감지 때 보낸 메일의 사진을 꺼내 파이프라인에 넣는다.
 *
 *  env: CAMERA_IMAP_USER, CAMERA_IMAP_PASSWORD (Gmail 앱 비밀번호), CAMERA_IMAP_HOST(기본 imap.gmail.com), CAMERA_IMAP_PORT(993)
 *  - 최근 48시간 메일을 읽음 여부와 무관하게 확인하고 DB에서 중복을 제거한다.
 *  - 최대 100통을 훑고 새 사진/재판정은 3장까지 처리한다.
 */
import { ImapFlow } from 'imapflow';
import PostalMime from 'postal-mime';
import { ingestCameraImage, type IngestResult } from '@/lib/camera-ingest';
import type { IncomingCameraImage } from '@/lib/camera-types';

const MAX_PER_RUN = 100;
const MAX_ACTIVE_IMAGES = 3;

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
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined;
  try {
    lock = await client.getMailboxLock('INBOX');
    const uids = (await client.search({ since: new Date(Date.now() - 48 * 60 * 60_000) }, { uid: true })) || [];
    let activeImages = 0;
    const deadline = Date.now() + 35_000;
    for (const uid of uids.slice(-MAX_PER_RUN).reverse()) {
      if (activeImages >= MAX_ACTIVE_IMAGES || Date.now() >= deadline) break;
      summary.checked += 1;
      try {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await PostalMime.parse(msg.source);
        const capturedAt = parsed.date ? new Date(parsed.date) : (msg.envelope?.date ?? new Date());
        const to = [...(parsed.to ?? []), ...(parsed.cc ?? [])].map(a => a.address ?? '').filter(Boolean);
        const images = parsed.attachments.filter(a => (a.mimeType || '').startsWith('image/'));
        for (const att of images) {
          if (activeImages >= MAX_ACTIVE_IMAGES || Date.now() >= deadline) break;
          const img: IncomingCameraImage = {
            source: 'imap',
            messageId: parsed.messageId ? `${parsed.messageId}#${att.filename ?? images.indexOf(att)}` : `imap:${client.mailbox && client.mailbox.uidValidity}:${uid}#${images.indexOf(att)}`,
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
          const result = await ingest(img);
          summary.results.push(result);
          if (result.status !== 'duplicate' && result.status !== 'unmapped') activeImages++;
          if (result.error) summary.errors.push('uid ' + uid + ': ' + result.error);
        }
        // Do not change the host's read/unread status.
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push(`uid ${uid}: ${message}`);
        console.error('[camera-inbox] message failed', uid, message);
      }
    }
  } finally {
    lock?.release();
    await client.logout().catch(() => null);
  }
  return summary;
}
