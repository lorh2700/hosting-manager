import { NextResponse } from 'next/server';
import { getSessionWithUser } from '@/lib/auth';
import {
  getAccessibleThread,
  markGuestMessagesRead,
  WelcomepadChatConfigError,
} from '@/lib/welcomepadChat';

// Mark a thread's unread guest messages as read by the host.
export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const n = Number(body?.threadId);
    const threadId = Number.isInteger(n) && n > 0 ? n : null;
    if (!threadId) {
      return NextResponse.json({ error: 'threadId가 필요합니다.' }, { status: 400 });
    }

    const access = await getAccessibleThread(auth, threadId);
    if (!access) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    const updated = await markGuestMessagesRead(threadId);
    return NextResponse.json({ updated });
  } catch (e) {
    if (e instanceof WelcomepadChatConfigError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    console.error('[welcomepad-chat/mark-read] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
