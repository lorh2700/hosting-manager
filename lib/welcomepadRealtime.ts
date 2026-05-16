'use client';

/**
 * Browser-side Supabase Realtime "doorbell" for in-room pad chat.
 *
 * The anon (publishable) key is low-privilege and already shipped publicly in
 * the welcome-pad. Here it is used ONLY to receive change notifications; the
 * page always re-fetches authoritative, permission-checked data from the
 * /api/welcomepad-chat routes (service_role server-side).
 *
 * If NEXT_PUBLIC_SUPABASE_ANON_KEY is unset/placeholder, this stays disabled
 * and the page falls back to polling — no rework needed when the key lands.
 */

import {
  createClient,
  type SupabaseClient,
  type RealtimeChannel,
} from '@supabase/supabase-js';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function looksLikePlaceholder(v: string): boolean {
  if (!v) return true;
  if (v.includes('<') || v.includes('>')) return true;
  if (/PASTE_/i.test(v)) return true;
  return v.length < 40; // real keys are long JWTs
}

export const isWelcomepadRealtimeConfigured =
  !!SB_URL && !looksLikePlaceholder(SB_ANON);

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient | null {
  if (!isWelcomepadRealtimeConfigured) return null;
  if (!client) {
    client = createClient(SB_URL, SB_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export interface WpRealtimeEvent {
  table: 'welcomepad_messages' | 'welcomepad_message_threads';
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown> | null;
}

/**
 * Subscribe to message/thread changes for the given property keys.
 * Returns an unsubscribe function. No-op (returns noop) when realtime is
 * not configured or there are no keys.
 */
export function subscribeWelcomepadChat(
  propertyKeys: string[],
  onEvent: (e: WpRealtimeEvent) => void,
): () => void {
  const sb = getClient();
  if (!sb || propertyKeys.length === 0) return () => {};

  const channel: RealtimeChannel = sb.channel(
    'wp-host-' + propertyKeys.slice().sort().join('_'),
  );

  for (const key of propertyKeys) {
    const filter = `property_key=eq.${key}`;
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'welcomepad_messages', filter },
      (p) =>
        onEvent({
          table: 'welcomepad_messages',
          eventType: p.eventType as WpRealtimeEvent['eventType'],
          new: (p.new as Record<string, unknown>) ?? null,
        }),
    );
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'welcomepad_message_threads', filter },
      (p) =>
        onEvent({
          table: 'welcomepad_message_threads',
          eventType: p.eventType as WpRealtimeEvent['eventType'],
          new: (p.new as Record<string, unknown>) ?? null,
        }),
    );
  }

  channel.subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}
