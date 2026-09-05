import { withAuth, ok, fail, MESSAGES } from '@/lib/core/http';
import { getAccessibleThread, markGuestMessagesRead, WelcomepadChatConfigError } from '@/lib/welcomepadChat';

// Mark a thread's unread guest messages as read by the host.
export const POST = withAuth('welcomepad-chat/mark-read', async (req, { auth }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const n = Number(body.threadId);
    if (!Number.isInteger(n) || n <= 0) throw fail(400, 'threadId가 필요합니다.');

    const access = await getAccessibleThread(auth, n);
    if (!access) throw fail(403, MESSAGES.forbidden);
    return ok({ updated: await markGuestMessagesRead(n) });
  } catch (e) {
    if (e instanceof WelcomepadChatConfigError) throw fail(503, e.message);
    throw e;
  }
});
