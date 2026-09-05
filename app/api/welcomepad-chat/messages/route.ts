import { withAuth, ok, created, fail, MESSAGES, query } from '@/lib/core/http';
import { getAccessibleThread, listMessages, insertHostMessage, WelcomepadChatConfigError } from '@/lib/welcomepadChat';

function parseThreadId(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw fail(400, 'threadId가 필요합니다.');
  return n;
}

function translateConfigError(e: unknown): never {
  if (e instanceof WelcomepadChatConfigError) throw fail(503, e.message);
  throw e;
}

// Messages of one in-room thread.
export const GET = withAuth('welcomepad-chat/messages', async (req, { auth }) => {
  try {
    const threadId = parseThreadId(query(req, 'threadId'));
    const access = await getAccessibleThread(auth, threadId);
    if (!access) throw fail(403, MESSAGES.forbidden);
    return ok({ thread: access.thread, messages: await listMessages(threadId) });
  } catch (e) {
    translateConfigError(e);
  }
});

// Host reply. Only active threads accept new host messages.
export const POST = withAuth('welcomepad-chat/messages', async (req, { auth }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const threadId = parseThreadId(body.threadId);
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) throw fail(400, '메시지 내용이 비어 있습니다.');

    const access = await getAccessibleThread(auth, threadId);
    if (!access) throw fail(403, MESSAGES.forbidden);
    if (!access.thread.is_active) throw fail(409, '종료된 대화에는 메시지를 보낼 수 없습니다.');

    return created({ message: await insertHostMessage(threadId, access.thread.property_key, text) });
  } catch (e) {
    translateConfigError(e);
  }
});
