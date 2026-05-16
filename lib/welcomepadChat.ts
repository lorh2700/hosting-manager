/**
 * In-room pad chat — server-side access to the welcome-pad Supabase tables
 * (welcomepad_message_threads / welcomepad_messages).
 *
 * Same Supabase project as Storage. We talk to PostgREST directly with the
 * service_role key (RLS bypass, no extra deps — mirrors lib/supabaseStorage.ts).
 * Permission enforcement lives in the API routes (session + Property.welcomepadKey),
 * never in the client.
 *
 * The browser only ever subscribes to Supabase Realtime with the public anon
 * key as a "doorbell"; all reads/writes flow through the server here.
 */

import { prisma } from './prisma';

export interface AllowedProp {
  propertyId: string;
  welcomepadKey: string;
  name: string;
}

/**
 * Welcome-pad-linked properties the session may see. Admins → all properties
 * with a welcomepadKey; hosts → only their assigned ones. The returned
 * welcomepadKey is what maps to welcomepad_*.property_key in Supabase.
 */
export async function resolveAllowedWelcomepadProps(auth: {
  isAdmin: boolean;
  propertyIds: string[] | null;
}): Promise<AllowedProp[]> {
  if (!auth.isAdmin && (auth.propertyIds ?? []).length === 0) return [];
  const props = await prisma.property.findMany({
    where: {
      welcomepadKey: { not: null },
      ...(auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } }),
    },
    select: { id: true, welcomepadKey: true, name: true },
  });
  const out: AllowedProp[] = [];
  for (const p of props) {
    if (p.welcomepadKey) {
      out.push({ propertyId: p.id, welcomepadKey: p.welcomepadKey, name: p.name });
    }
  }
  return out;
}

function deriveSupabaseUrl(): string | null {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/$/, '');
  const dbUser = process.env.DB_USER || '';
  const m = dbUser.match(/^postgres\.([a-z0-9]+)$/i);
  if (m) return `https://${m[1]}.supabase.co`;
  return null;
}

function looksLikePlaceholder(value: string): boolean {
  if (!value) return true;
  if (value.includes('<') || value.includes('>')) return true;
  if (value.length < 40) return true; // real keys are long JWTs
  return false;
}

export class WelcomepadChatConfigError extends Error {}

function restBase(): { url: string; key: string } {
  const url = deriveSupabaseUrl();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url) {
    throw new WelcomepadChatConfigError('.env.local 에 SUPABASE_URL 을 설정해주세요.');
  }
  if (looksLikePlaceholder(key)) {
    throw new WelcomepadChatConfigError(
      'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다. Supabase Dashboard → ' +
        'Project Settings → API → service_role 키를 .env.local 에 넣고 서버를 재시작하세요.',
    );
  }
  return { url: `${url}/rest/v1`, key };
}

async function wpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = restBase();
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

export interface WpThread {
  id: number;
  property_key: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  is_active: boolean;
  last_message_at: string | null;
  created_at: string;
}

export interface WpMessage {
  id: number;
  thread_id: number;
  property_key: string;
  sender: 'guest' | 'host' | 'system';
  body: string;
  lang: string | null;
  read_by_guest_at: string | null;
  read_by_host_at: string | null;
  created_at: string;
}

// PostgREST `in.(...)` list. Our property keys are simple slugs (anon,
// unwadang, …); reject anything else defensively so this can't be abused
// to inject filter syntax.
function inList(values: string[]): string {
  const safe = values.filter(v => /^[a-z0-9_-]+$/i.test(v));
  return `(${safe.join(',')})`;
}

async function readJson<T>(res: Response, ctx: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`welcomepad chat ${ctx} 실패: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Threads for the given property keys, newest-active first (mirrors admin.html). */
export async function listThreads(propertyKeys: string[]): Promise<WpThread[]> {
  if (propertyKeys.length === 0) return [];
  const res = await wpFetch(
    `/welcomepad_message_threads?property_key=in.${inList(propertyKeys)}` +
      `&select=*&order=is_active.desc,last_message_at.desc&limit=100`,
  );
  return readJson<WpThread[]>(res, 'thread 조회');
}

export async function getThread(threadId: number): Promise<WpThread | null> {
  const res = await wpFetch(
    `/welcomepad_message_threads?id=eq.${threadId}&select=*&limit=1`,
  );
  const rows = await readJson<WpThread[]>(res, 'thread 단건 조회');
  return rows[0] || null;
}

export async function listMessages(threadId: number): Promise<WpMessage[]> {
  const res = await wpFetch(
    `/welcomepad_messages?thread_id=eq.${threadId}&select=*&order=created_at.asc`,
  );
  return readJson<WpMessage[]>(res, '메시지 조회');
}

/** Per-thread count of guest messages the host hasn't read yet. */
export async function unreadCountsByThread(
  propertyKeys: string[],
): Promise<Record<number, number>> {
  if (propertyKeys.length === 0) return {};
  const res = await wpFetch(
    `/welcomepad_messages?property_key=in.${inList(propertyKeys)}` +
      `&sender=eq.guest&read_by_host_at=is.null&select=thread_id`,
  );
  const rows = await readJson<{ thread_id: number }[]>(res, '안읽음 카운트');
  const counts: Record<number, number> = {};
  for (const r of rows) counts[r.thread_id] = (counts[r.thread_id] || 0) + 1;
  return counts;
}

export async function insertHostMessage(
  threadId: number,
  propertyKey: string,
  body: string,
): Promise<WpMessage> {
  const res = await wpFetch(`/welcomepad_messages`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      thread_id: threadId,
      property_key: propertyKey,
      sender: 'host',
      body,
    }),
  });
  const rows = await readJson<WpMessage[]>(res, '메시지 전송');
  return rows[0];
}

/**
 * Load a thread and confirm the session may access it (its property_key maps
 * to one of the session's welcome-pad-linked properties). Returns null when
 * the thread is missing or out of scope — callers map that to 404/403.
 */
export async function getAccessibleThread(
  auth: { isAdmin: boolean; propertyIds: string[] | null },
  threadId: number,
): Promise<{ thread: WpThread; prop: AllowedProp } | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;
  const props = await resolveAllowedWelcomepadProps(auth);
  const prop = props.find(p => p.welcomepadKey === thread.property_key);
  if (!prop) return null;
  return { thread, prop };
}

/** Mark all unread guest messages in a thread as read by the host. */
export async function markGuestMessagesRead(threadId: number): Promise<number> {
  const res = await wpFetch(
    `/welcomepad_messages?thread_id=eq.${threadId}&sender=eq.guest&read_by_host_at=is.null`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ read_by_host_at: new Date().toISOString() }),
    },
  );
  const rows = await readJson<WpMessage[]>(res, '읽음 처리');
  return rows.length;
}
