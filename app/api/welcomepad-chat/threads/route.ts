import { withAuth, ok, fail } from '@/lib/core/http';
import { resolveAllowedWelcomepadProps, listThreads, unreadCountsByThread, WelcomepadChatConfigError } from '@/lib/welcomepadChat';

// In-room pad chat — conversation list for the host. Each thread = one stay.
export const GET = withAuth('welcomepad-chat/threads', async (_req, { auth }) => {
  try {
    const props = await resolveAllowedWelcomepadProps(auth);
    if (props.length === 0) return ok({ properties: [], threads: [] });

    const keys = props.map(p => p.welcomepadKey);
    const keyToName = Object.fromEntries(props.map(p => [p.welcomepadKey, p.name]));
    const keyToPropertyId = Object.fromEntries(props.map(p => [p.welcomepadKey, p.propertyId]));

    const [threads, unread] = await Promise.all([listThreads(keys), unreadCountsByThread(keys)]);
    return ok({
      properties: props,
      threads: threads.map(t => ({
        ...t,
        propertyName: keyToName[t.property_key] || t.property_key,
        propertyId: keyToPropertyId[t.property_key] || null,
        unread: unread[t.id] || 0,
      })),
    });
  } catch (e) {
    if (e instanceof WelcomepadChatConfigError) throw fail(503, e.message);
    throw e;
  }
});
