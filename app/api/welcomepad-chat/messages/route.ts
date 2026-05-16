import { NextResponse } from 'next/server';
import { getSessionWithUser } from '@/lib/auth';
import {
  getAccessibleThread,
  listMessages,
  insertHostMessage,
  WelcomepadChatConfigError,
} from '@/lib/welcomepadChat';

function parseThreadId(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function handleError(e: unknown, ctx: string) {
  if (e instanceof WelcomepadChatConfigError) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  console.error(`[welcomepad-chat/messages] ${ctx} error:`, e);
  return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
}

// Messages of one in-room thread.
export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const threadId = parseThreadId(new URL(req.url).searchParams.get('threadId'));
    if (!threadId) {
      return NextResponse.json({ error: 'threadId가 필요합니다.' }, { status: 400 });
    }

    const access = await getAccessibleThread(auth, threadId);
    if (!access) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

    const messages = await listMessages(threadId);
    return NextResponse.json({ thread: access.thread, messages });
  } catch (e) {
    return handleError(e, 'GET');
  }
}

// Host reply. Only active threads accept new host messages (mirrors the
// pad's read-only behaviour on checked-out stays).
export async function POST(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const threadId = parseThreadId(body?.threadId != null ? String(body.threadId) : null);
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!threadId) {
      return NextResponse.json({ error: 'threadId가 필요합니다.' }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: '메시지 내용이 비어 있습니다.' }, { status: 400 });
    }

    const access = await getAccessibleThread(auth, threadId);
    if (!access) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    if (!access.thread.is_active) {
      return NextResponse.json({ error: '종료된 대화에는 메시지를 보낼 수 없습니다.' }, { status: 409 });
    }

    const message = await insertHostMessage(threadId, access.thread.property_key, text);
    return NextResponse.json({ message }, { status: 201 });
  } catch (e) {
    return handleError(e, 'POST');
  }
}
