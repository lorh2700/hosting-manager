import { NextResponse } from 'next/server';
import { getSessionWithUser } from '@/lib/auth';
import {
  resolveAllowedWelcomepadProps,
  listThreads,
  unreadCountsByThread,
  WelcomepadChatConfigError,
} from '@/lib/welcomepadChat';

// In-room pad chat — conversation list for the host.
// Each thread = one stay (welcomepad_message_threads). Filtered to the
// session's welcome-pad-linked properties.
export async function GET(req: Request) {
  try {
    const auth = await getSessionWithUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const props = await resolveAllowedWelcomepadProps(auth);
    if (props.length === 0) {
      return NextResponse.json({ properties: [], threads: [] });
    }

    const keys = props.map(p => p.welcomepadKey);
    const keyToName = Object.fromEntries(props.map(p => [p.welcomepadKey, p.name]));
    const keyToPropertyId = Object.fromEntries(props.map(p => [p.welcomepadKey, p.propertyId]));

    const [threads, unread] = await Promise.all([
      listThreads(keys),
      unreadCountsByThread(keys),
    ]);

    return NextResponse.json({
      properties: props,
      threads: threads.map(t => ({
        ...t,
        propertyName: keyToName[t.property_key] || t.property_key,
        propertyId: keyToPropertyId[t.property_key] || null,
        unread: unread[t.id] || 0,
      })),
    });
  } catch (e) {
    if (e instanceof WelcomepadChatConfigError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    console.error('[welcomepad-chat/threads] GET error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
