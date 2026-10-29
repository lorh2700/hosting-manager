import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail } from './core/errors';

const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const language = z.enum(['ko', 'en', 'ja', 'zh']).nullable().optional();
const nullableText = (max: number) => z.string().max(max).nullable().optional();
const empty = z.object({}).strict().optional();
const fields = z.object({
  hotel_name: nullableText(200), logo_type: z.enum(['text', 'image']).optional(),
  logo_image: z.string().max(700_000).refine(value => (/^https:\/\//.test(value) && URL.canParse(value) && !/[\s"'<>]/.test(value)) || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)).nullable().optional(),
  theme: nullableText(100), theme_gradient: nullableText(300), wifi_ssid: nullableText(200),
  wifi_password: nullableText(200), wifi_encryption: z.enum(['WPA', 'WEP', 'nopass']).optional(),
  cleaning_mode: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0);
const instant = z.string().max(40).refine(value => /^\d{4}-\d{2}-\d{2}(T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(Date.parse(value)));
const scope = { propertyKey: key };
const operation = <N extends string, T extends z.ZodType>(name: N, data: T) => z.object({ operation: z.literal(name), ...scope, data }).strict();

export const welcomepadDataSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('properties.list'), data: empty }).strict(),
  operation('config.get', empty), operation('config.update', fields),
  operation('cleaning.set', z.object({ cleaning_mode: z.boolean() }).strict()),
  operation('weather.get', empty),
  operation('weather.update', z.object({ temp: z.number().min(-100).max(100), feels_like: z.number().min(-100).max(100), description: z.string().max(200), icon: z.string().regex(/^\d{2}[dn]$/) }).strict()),
  operation('events.create', z.object({ event_type: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), event_data: z.record(z.string(), z.unknown()).nullable().optional(), lang: language, session_id: nullableText(100), user_agent: nullableText(512) }).strict()),
  operation('events.list', z.object({ since: instant, until: instant, limit: z.number().int().min(1).max(1000).default(1000), offset: z.number().int().min(0).max(100_000).default(0) }).strict()),
  operation('threads.list', empty), operation('threads.active', empty), operation('threads.current', empty),
  operation('threads.close', z.object({ threadId: id }).strict()),
  operation('messages.list', z.object({ threadId: id, afterId: id.optional(), limit: z.number().int().min(1).max(1000).default(500) }).strict()),
  operation('messages.send', z.object({ threadId: id, sender: z.enum(['guest', 'host']), body: z.string().trim().min(1).max(5000), lang: language }).strict()),
  operation('messages.read', z.object({ threadId: id, reader: z.enum(['guest', 'host']) }).strict()),
  operation('devices.list', empty),
  z.object({ operation: z.literal('devices.upsert'), data: z.object({ host_id: z.string().min(1).max(200).optional(), fcm_token: z.string().min(1).max(4096), property_keys: z.array(key).max(100), device_label: nullableText(200) }).strict() }).strict(),
]);
export type WelcomepadOperation = z.infer<typeof welcomepadDataSchema>;
export type PadProperty = { id: string; name: string; welcomepad_key: string };
export type PadActor = { kind: 'service' } | { kind: 'staff'; userId: string; propertyIds: string[] | null } | {
  kind: 'device'; propertyId: string; stay?: { guestName: string; checkIn: string; checkOut: string };
};

export function parseWelcomepadOperation(value: unknown): WelcomepadOperation {
  const parsed = welcomepadDataSchema.safeParse(value);
  if (!parsed.success) throw fail(400, '잘못된 패드 요청입니다.');
  const input = parsed.data;
  if (input.operation === 'events.create' && JSON.stringify(input.data.event_data ?? {}).length > 8192) throw fail(413, '이벤트 데이터가 너무 큽니다.');
  if (input.operation === 'events.list') {
    const span = Date.parse(input.data.until) - Date.parse(input.data.since);
    if (span <= 0 || span > 366 * 86400000) throw fail(400, '조회 기간을 확인해 주세요.');
  }
  return input;
}

export const usesCloudSqlPadData = () => process.env.BACKEND_DB_TRANSPORT === 'cloudsql-unix';
export type PadSql = Pick<typeof prisma, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export function padJson<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'bigint') return item;
    const number = Number(item);
    if (!Number.isSafeInteger(number)) throw new Error('Pad identifier is outside supported range');
    return number;
  })) as T;
}

async function rows<T>(db: PadSql, sql: string, ...values: unknown[]): Promise<T[]> {
  return padJson<T[]>(await db.$queryRawUnsafe(sql, ...values));
}
export async function findPadProperty(propertyKey: string, db: PadSql = prisma): Promise<PadProperty | null> {
  return (await rows<PadProperty>(db, 'SELECT id, name, welcomepad_key FROM properties WHERE welcomepad_key = $1 LIMIT 1', propertyKey))[0] ?? null;
}

const configColumns = 'property_id, hotel_name, logo_type, logo_image, theme, theme_gradient, wifi_ssid, wifi_password, wifi_encryption, cleaning_mode, updated_at';
const threadColumns = 'id, property_key, guest_name, check_in::text, check_out::text, is_active, last_message_at, created_at';
const messageColumns = 'id, thread_id, property_key, sender, body, lang, read_by_guest_at, read_by_host_at, created_at';
type Thread = { id: number; property_key: string; guest_name: string | null; check_in: string | null; check_out: string | null; is_active: boolean; [key: string]: unknown };

export async function sqlPadThreads(propertyKeys: string[], db: PadSql = prisma) {
  if (!propertyKeys.length) return [];
  return rows<Thread>(db, `SELECT ${threadColumns}, (SELECT count(*)::int FROM welcomepad_messages m WHERE m.thread_id = t.id AND m.sender = 'guest' AND m.read_by_host_at IS NULL) AS unread_count FROM welcomepad_message_threads t WHERE property_key = ANY($1::text[]) ORDER BY is_active DESC, last_message_at DESC NULLS LAST, id DESC LIMIT 100`, propertyKeys);
}
export async function sqlPadThread(threadId: number, db: PadSql = prisma) {
  return (await rows<Thread>(db, `SELECT ${threadColumns} FROM welcomepad_message_threads WHERE id = $1 LIMIT 1`, threadId))[0] ?? null;
}
export async function sqlPadMessages(threadId: number, db: PadSql = prisma, afterId = 0, limit = 1000) {
  return rows<Record<string, unknown>>(db, `SELECT ${messageColumns} FROM welcomepad_messages WHERE thread_id = $1 AND id > $2 ORDER BY created_at ASC, id ASC LIMIT $3`, threadId, afterId, limit);
}
export async function sqlPadUnread(propertyKeys: string[], db: PadSql = prisma): Promise<Record<number, number>> {
  if (!propertyKeys.length) return {};
  const counts = await rows<{ thread_id: number; count: number }>(db, "SELECT thread_id, count(*)::int AS count FROM welcomepad_messages WHERE property_key = ANY($1::text[]) AND sender = 'guest' AND read_by_host_at IS NULL GROUP BY thread_id", propertyKeys);
  return Object.fromEntries(counts.map(row => [row.thread_id, row.count]));
}
export async function sqlPadSend(threadId: number, propertyKey: string, sender: 'guest' | 'host', body: string, lang: string | null = null, db: PadSql = prisma) {
  const result = await rows<Record<string, unknown>>(db, `INSERT INTO welcomepad_messages (thread_id, property_key, sender, body, lang) SELECT id, property_key, $3, $4, $5 FROM welcomepad_message_threads WHERE id = $1 AND property_key = $2 AND is_active = true RETURNING ${messageColumns}`, threadId, propertyKey, sender, body, lang);
  if (!result[0]) throw fail(409, '종료되었거나 다른 숙소의 대화입니다.');
  return result[0];
}
export async function sqlPadRead(threadId: number, reader: 'guest' | 'host', db: PadSql = prisma) {
  const sql = reader === 'host'
    ? "UPDATE welcomepad_messages SET read_by_host_at = now() WHERE thread_id = $1 AND sender = 'guest' AND read_by_host_at IS NULL"
    : "UPDATE welcomepad_messages SET read_by_guest_at = now() WHERE thread_id = $1 AND sender = 'host' AND read_by_guest_at IS NULL";
  return db.$executeRawUnsafe(sql, threadId);
}

export async function executeWelcomepadOperation(input: WelcomepadOperation, actor: PadActor): Promise<unknown> {
  if (input.operation === 'properties.list') {
    if (actor.kind === 'device') throw fail(403, '권한이 없습니다.');
    return rows<PadProperty>(prisma, actor.kind === 'staff' && actor.propertyIds !== null
      ? 'SELECT id, name, welcomepad_key FROM properties WHERE welcomepad_key IS NOT NULL AND id = ANY($1::text[]) ORDER BY name LIMIT 100'
      : 'SELECT id, name, welcomepad_key FROM properties WHERE welcomepad_key IS NOT NULL ORDER BY name LIMIT 100',
    ...(actor.kind === 'staff' && actor.propertyIds !== null ? [actor.propertyIds] : []));
  }
  if (input.operation === 'devices.upsert') {
    if (actor.kind !== 'staff' || (input.data.host_id && input.data.host_id !== actor.userId)) throw fail(403, '권한이 없습니다.');
    const linked = await rows<PadProperty>(prisma, 'SELECT id, name, welcomepad_key FROM properties WHERE welcomepad_key = ANY($1::text[])', input.data.property_keys);
    if (!input.data.property_keys.length && actor.propertyIds !== null) throw fail(403, '알림을 받을 숙소를 선택해 주세요.');
    if (linked.length !== new Set(input.data.property_keys).size || linked.some(p => actor.propertyIds !== null && !actor.propertyIds.includes(p.id))) throw fail(403, '권한이 없는 숙소가 포함되어 있습니다.');
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `pad-device:${actor.userId}`);
      const existing = await rows<{ id: number }>(tx, 'SELECT id FROM welcomepad_host_devices WHERE host_id = $1 LIMIT 1', actor.userId);
      if (existing[0]) await tx.$executeRawUnsafe('UPDATE welcomepad_host_devices SET fcm_token = $2, property_keys = $3::text[], device_label = $4, last_seen_at = now() WHERE host_id = $1', actor.userId, input.data.fcm_token, input.data.property_keys, input.data.device_label ?? null);
      else await tx.$executeRawUnsafe('INSERT INTO welcomepad_host_devices (host_id, fcm_token, property_keys, device_label) VALUES ($1, $2, $3::text[], $4)', actor.userId, input.data.fcm_token, input.data.property_keys, input.data.device_label ?? null);
    });
    return { ok: true };
  }
  const prop = await findPadProperty(input.propertyKey);
  if (!prop) throw fail(404, '숙소를 찾을 수 없습니다.');
  if (actor.kind === 'device' && actor.propertyId !== prop.id) throw fail(403, '이 패드의 숙소가 아닙니다.');
  if (actor.kind === 'staff' && actor.propertyIds !== null && !actor.propertyIds.includes(prop.id)) throw fail(403, '권한이 없습니다.');
  switch (input.operation) {
    case 'config.get':
      return (await rows(prisma, `SELECT ${configColumns} FROM welcomepad_configs WHERE property_id = $1`, prop.id))[0] ?? null;
    case 'config.update':
    case 'cleaning.set': {
      const updates = Object.entries(input.data);
      const values = updates.map(([, value]) => value);
      const assignments = updates.map(([column], index) => `"${column}" = $${index + 2}`);
      return prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('INSERT INTO welcomepad_configs (property_id) VALUES ($1) ON CONFLICT (property_id) DO NOTHING', prop.id);
        return (await rows(tx, `UPDATE welcomepad_configs SET ${assignments.join(', ')}, updated_at = now() WHERE property_id = $1 RETURNING ${configColumns}`, prop.id, ...values))[0];
      });
    }
    case 'weather.get':
      return (await rows(prisma, 'SELECT property_key, temp::float8, feels_like::float8, description, icon, updated_at FROM welcomepad_weather WHERE property_key = $1', input.propertyKey))[0] ?? null;
    case 'weather.update':
      return (await rows(prisma, 'INSERT INTO welcomepad_weather (property_key, temp, feels_like, description, icon) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (property_key) DO UPDATE SET temp=EXCLUDED.temp, feels_like=EXCLUDED.feels_like, description=EXCLUDED.description, icon=EXCLUDED.icon, updated_at=now() RETURNING property_key, temp::float8, feels_like::float8, description, icon, updated_at', input.propertyKey, input.data.temp, input.data.feels_like, input.data.description, input.data.icon))[0];
    case 'events.create':
      await prisma.$executeRawUnsafe('INSERT INTO welcomepad_events (property, event_type, event_data, lang, session_id, user_agent) VALUES ($1,$2,$3::jsonb,$4,$5,$6)', input.propertyKey, input.data.event_type, JSON.stringify(input.data.event_data ?? null), input.data.lang ?? null, input.data.session_id ?? null, input.data.user_agent ?? null);
      return { ok: true };
    case 'events.list':
      return rows(prisma, 'SELECT id, property, event_type, event_data, lang, session_id, user_agent, created_at FROM welcomepad_events WHERE property = $1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5', input.propertyKey, input.data.since, input.data.until, input.data.limit, input.data.offset);
    case 'threads.list': return sqlPadThreads([input.propertyKey]);
    case 'threads.current': {
      const thread = (await rows<Thread>(prisma, `SELECT ${threadColumns} FROM welcomepad_message_threads WHERE property_key = $1 AND is_active = true LIMIT 1`, input.propertyKey))[0] ?? null;
      if (actor.kind === 'device' && (!actor.stay || thread?.guest_name !== actor.stay.guestName || thread.check_in !== actor.stay.checkIn || thread.check_out !== actor.stay.checkOut)) return null;
      return thread;
    }
    case 'threads.active': {
      const stay = actor.kind === 'device' ? actor.stay : undefined;
      if (!stay) throw fail(409, '현재 투숙 중인 예약을 확인해 주세요.');
      return prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `pad-thread:${input.propertyKey}`);
        await tx.$executeRawUnsafe('UPDATE welcomepad_message_threads SET is_active = false WHERE property_key = $1 AND is_active = true AND (guest_name IS DISTINCT FROM $2 OR check_in IS DISTINCT FROM $3::date OR check_out IS DISTINCT FROM $4::date)', input.propertyKey, stay.guestName, stay.checkIn, stay.checkOut);
        const current = await rows<{ id: number }>(tx, 'SELECT id FROM welcomepad_message_threads WHERE property_key = $1 AND is_active = true LIMIT 1', input.propertyKey);
        if (current[0]) return current[0].id;
        return (await rows<{ id: number }>(tx, 'INSERT INTO welcomepad_message_threads (property_key, guest_name, check_in, check_out, is_active) VALUES ($1,$2,$3::date,$4::date,true) RETURNING id', input.propertyKey, stay.guestName, stay.checkIn, stay.checkOut))[0].id;
      });
    }
    case 'threads.close': return prisma.$executeRawUnsafe('UPDATE welcomepad_message_threads SET is_active = false WHERE id = $1 AND property_key = $2 AND is_active = true', input.data.threadId, input.propertyKey);
    case 'messages.list':
    case 'messages.send':
    case 'messages.read': {
      const thread = await sqlPadThread(input.data.threadId);
      if (!thread || thread.property_key !== input.propertyKey) throw fail(404, '대화를 찾을 수 없습니다.');
      if (actor.kind === 'device' && (!thread.is_active || !actor.stay || thread.guest_name !== actor.stay.guestName || thread.check_in !== actor.stay.checkIn || thread.check_out !== actor.stay.checkOut)) throw fail(403, '현재 투숙 중인 대화가 아닙니다.');
      if (input.operation === 'messages.list') return sqlPadMessages(input.data.threadId, prisma, input.data.afterId, input.data.limit);
      if (input.operation === 'messages.send') return sqlPadSend(input.data.threadId, input.propertyKey, input.data.sender, input.data.body, input.data.lang ?? null);
      return sqlPadRead(input.data.threadId, input.data.reader);
    }
    case 'devices.list': return rows(prisma, 'SELECT fcm_token, property_keys FROM welcomepad_host_devices WHERE cardinality(property_keys) = 0 OR property_keys IS NULL OR $1 = ANY(property_keys) LIMIT 500', input.propertyKey);
  }
}
