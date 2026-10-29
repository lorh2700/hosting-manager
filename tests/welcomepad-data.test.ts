import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { executeWelcomepadOperation, parseWelcomepadOperation, sqlPadUnread, type PadActor } from '../lib/welcomepad-data';
import { POST } from '../app/api/public/welcomepad/data/route';
import { db, resetDb, prismaOverrides } from './stubs/prisma';
import { actAsAnonymous, actAsManager, actAsAdmin, actAsCleaner } from './stubs/auth';
import { guestStayHash } from '../lib/guest-stay-store';
import { todayKst, addDaysToDateStr } from '../lib/dates';
import { GET as hostThreads } from '../app/api/welcomepad-chat/threads/route';
import { listThreads } from '../lib/welcomepadChat';

const sql = new PGlite();
const secret = 'fixture-pad-bridge-key';
const deviceToken = `gst_device_${'a'.repeat(43)}`;
const today = todayKst(), yesterday = addDaysToDateStr(today, -1), tomorrow = addDaysToDateStr(today, 1);
const staff: PadActor = { kind: 'staff', userId: 'host-1', propertyIds: ['p1'] };
const device: PadActor = { kind: 'device', propertyId: 'p1', stay: { guestName: 'Current Guest', checkIn: yesterday, checkOut: tomorrow } };
const service: PadActor = { kind: 'service' };
const previous = { transport: process.env.BACKEND_DB_TRANSPORT, key: process.env.WELCOMEPAD_API_KEY };

function adapter(target: Pick<PGlite, 'query'>) {
  return {
    $queryRawUnsafe: async <T>(statement: string, ...params: unknown[]) => (await target.query(statement, params)).rows as T,
    $executeRawUnsafe: async (statement: string, ...params: unknown[]) => (await target.query(statement, params)).affectedRows ?? 0,
  };
}
function run(operation: unknown, actor: PadActor = staff) { return executeWelcomepadOperation(parseWelcomepadOperation(operation), actor); }
function request(operation: unknown, headers: Record<string, string> = {}) {
  return new Request('https://legacy.example/api/public/welcomepad/data', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': secret, ...headers }, body: JSON.stringify(operation) });
}
async function call(operation: unknown, headers: Record<string, string> = {}) {
  const response = await POST(request(operation, headers));
  return { status: response.status, body: await response.json(), headers: response.headers };
}

before(async () => {
  await sql.exec("CREATE TABLE properties(id text PRIMARY KEY, name text, welcomepad_key text UNIQUE); CREATE TABLE welcomepad_property(property_key text PRIMARY KEY);");
  for (const [path, tables] of [
    ['../../hotel-welcome-pad/supabase/migrations/001_welcomepad_events.sql', ['welcomepad_events']],
    ['../../hotel-welcome-pad/supabase/migrations/002_welcomepad_full_migration.sql', ['welcomepad_weather']],
    ['../../hotel-welcome-pad/supabase/migrations/004_welcomepad_chat.sql', ['welcomepad_message_threads', 'welcomepad_messages', 'welcomepad_host_devices']],
    ['../prisma/migrations/20260510020000_welcomepad_property_merge/migration.sql', ['welcomepad_configs']],
  ] as const) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    for (const table of tables) {
      const create = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS "?${table}"? \\([\\s\\S]*?\\n\\);`, 'i'))?.[0];
      assert.ok(create, table);
      await sql.exec(create);
    }
  }
  await sql.exec('CREATE UNIQUE INDEX one_active ON welcomepad_message_threads(property_key) WHERE is_active = true;');
});
beforeEach(async () => {
  resetDb(); actAsAnonymous();
  process.env.BACKEND_DB_TRANSPORT = 'cloudsql-unix'; process.env.WELCOMEPAD_API_KEY = secret;
  await sql.exec("TRUNCATE properties, welcomepad_property, welcomepad_configs, welcomepad_events, welcomepad_weather, welcomepad_messages, welcomepad_message_threads, welcomepad_host_devices RESTART IDENTITY CASCADE; INSERT INTO properties VALUES('p1','Fixture One','anon'),('p2','Fixture Two','unwadang'); INSERT INTO welcomepad_property VALUES('anon'),('unwadang'); INSERT INTO welcomepad_configs(property_id,wifi_ssid,wifi_password) VALUES('p1','Fixture Wi-Fi','fixture-wifi-password');");
  Object.assign(prismaOverrides, adapter(sql));
  prismaOverrides.$transaction = (work: (tx: ReturnType<typeof adapter>) => Promise<unknown>) => sql.transaction(tx => work(adapter(tx)));
  prismaOverrides.$queryRaw = async () => [{ count: 1 }];
  prismaOverrides.$executeRaw = async () => 0;
  db.property = [{ id: 'p1', name: 'Fixture One', slug: 'anon', welcomepadKey: 'anon', status: 'active' }, { id: 'p2', name: 'Fixture Two', slug: 'unwadang', welcomepadKey: 'unwadang', status: 'active' }];
  db.guestStayDevice = [{ id: 'device-1', tokenHash: guestStayHash(deviceToken), propertyId: 'p1', pairedAt: new Date(), revokedAt: null, expiresAt: new Date(Date.now() + 86400000) }];
  db.booking = [{ id: 'booking-1', propertyId: 'p1', name: 'Current Guest', checkIn: yesterday, checkOut: tomorrow, guests: 2, status: 'confirmed' }];
});
after(async () => {
  resetDb(); await sql.close();
  for (const [name, value] of [['BACKEND_DB_TRANSPORT', previous.transport], ['WELCOMEPAD_API_KEY', previous.key]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});

test('bridge secret alone cannot read settings; rollout stays disabled unless Cloud SQL is explicit', async () => {
  const input = { operation: 'config.get', propertyKey: 'anon' };
  assert.equal((await call(input, { 'x-api-key': 'wrong' })).status, 401);
  assert.equal((await call(input)).status, 401);
  delete process.env.BACKEND_DB_TRANSPORT;
  assert.equal((await call(input, { authorization: `Bearer ${deviceToken}` })).status, 503);
});

test('paired devices retain guest Wi-Fi fields but cannot cross properties, impersonate staff or use server operations', async () => {
  const headers = { authorization: `Bearer ${deviceToken}` };
  const config = await call({ operation: 'config.get', propertyKey: 'anon' }, headers);
  assert.equal(config.status, 200); assert.equal(config.body.data.wifi_password, 'fixture-wifi-password');
  assert.equal(config.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call({ operation: 'config.get', propertyKey: 'unwadang' }, headers)).status, 403);
  assert.equal((await call({ operation: 'properties.list' }, headers)).status, 403);
  assert.equal((await call({ operation: 'config.update', propertyKey: 'anon', data: { wifi_password: 'changed' } }, headers)).status, 403);
  assert.equal((await call({ operation: 'messages.send', propertyKey: 'anon', data: { threadId: 1, sender: 'host', body: 'fake host' } }, headers)).status, 403);
  assert.equal((await call({ operation: 'devices.list', propertyKey: 'anon' }, headers)).status, 403);
  const cleaning = await call({ operation: 'cleaning.set', propertyKey: 'anon', data: { cleaning_mode: true } }, headers);
  assert.equal(cleaning.status, 200); assert.equal(cleaning.body.data.cleaning_mode, true);
  db.guestStayDevice[0].revokedAt = new Date();
  assert.equal((await call({ operation: 'config.get', propertyKey: 'anon' }, headers)).status, 401);
});

test('staff scope is enforced and internal credentials cannot turn into a browser pass-through', async () => {
  actAsManager(['p1']);
  assert.deepEqual((await call({ operation: 'properties.list' }, { cookie: 'va_session=fixture' })).body.data.map((p: { id: string }) => p.id), ['p1']);
  assert.equal((await call({ operation: 'config.get', propertyKey: 'unwadang' }, { cookie: 'va_session=fixture' })).status, 403);
  assert.equal((await call({ operation: 'devices.list', propertyKey: 'anon' }, { 'x-welcomepad-internal': '1', origin: 'https://pad.example' })).status, 403);
  assert.equal((await call({ operation: 'config.get', propertyKey: 'anon' }, { 'x-welcomepad-internal': '1' })).status, 403);
  assert.equal((await call({ operation: 'devices.list', propertyKey: 'anon' }, { 'x-welcomepad-internal': '1' })).status, 200);
  actAsCleaner(['p1']);
  assert.equal((await call({ operation: 'config.get', propertyKey: 'anon' }, { cookie: 'va_session=fixture' })).status, 403);
});

test('strict operations reject filter/column injection and unbounded data', () => {
  for (const input of [
    { operation: 'query', table: 'users' },
    { operation: 'config.get', propertyKey: 'anon) OR true' },
    { operation: 'config.update', propertyKey: 'anon', data: { property_id: 'p2' } },
    { operation: 'cleaning.set', propertyKey: 'anon', data: { cleaning_mode: true, wifi_password: 'extra' } },
    { operation: 'messages.list', propertyKey: 'anon', data: { threadId: 1, limit: 1001 } },
    { operation: 'events.list', propertyKey: 'anon', data: { since: '2020-01-01', until: '2030-01-01' } },
    { operation: 'events.create', propertyKey: 'anon', data: { event_type: 'open', event_data: { huge: 'a'.repeat(8193) } } },
    { operation: 'config.update', propertyKey: 'anon', data: { logo_image: 'javascript:alert(1)' } },
  ]) assert.throws(() => parseWelcomepadOperation(input));
});

test('SQL settings, weather and analytics preserve row contracts, scope and bounds', async () => {
  const config = await run({ operation: 'config.update', propertyKey: 'anon', data: { hotel_name: "Fixture'; DROP TABLE properties; --", logo_type: 'text' } }) as Record<string, unknown>;
  assert.equal(config.property_id, 'p1'); assert.equal(config.wifi_password, 'fixture-wifi-password');
  assert.equal((await sql.query('SELECT id FROM properties')).rows.length, 2);
  await run({ operation: 'weather.update', propertyKey: 'anon', data: { temp: 19, feels_like: 18, description: '맑음', icon: '01d' } }, service);
  const weather = await run({ operation: 'weather.get', propertyKey: 'anon' }, device) as Record<string, unknown>;
  assert.equal(weather.temp, 19); assert.equal(weather.description, '맑음');
  await run({ operation: 'events.create', propertyKey: 'anon', data: { event_type: 'menu_click', event_data: { menu: 'taxi' }, lang: 'ko' } }, device);
  const events = await run({ operation: 'events.list', propertyKey: 'anon', data: { since: yesterday, until: tomorrow } }) as Array<Record<string, unknown>>;
  assert.equal(events.length, 1); assert.deepEqual(events[0].event_data, { menu: 'taxi' });
  await assert.rejects(run({ operation: 'config.update', propertyKey: 'unwadang', data: { cleaning_mode: true } }), /권한/);
});

test('chat reuses one active thread, rotates prior stay, rejects historical/cross-property messages and marks only intended sender', async () => {
  const operation = { operation: 'threads.active', propertyKey: 'anon' };
  assert.equal(await run({ operation: 'threads.current', propertyKey: 'anon' }, device), null);
  assert.equal((await sql.query<{ count: number }>('SELECT count(*)::int AS count FROM welcomepad_message_threads')).rows[0].count, 0);
  const first = await run(operation, device) as number;
  assert.equal((await run({ operation: 'threads.current', propertyKey: 'anon' }, device) as { id: number }).id, first);
  assert.equal(await run(operation, device), first);
  await run({ operation: 'messages.send', propertyKey: 'anon', data: { threadId: first, sender: 'guest', body: 'hello' } }, device);
  const host = await run({ operation: 'messages.send', propertyKey: 'anon', data: { threadId: first, sender: 'host', body: 'welcome' } }) as Record<string, unknown>;
  assert.deepEqual(await sqlPadUnread(['anon']), { [first]: 1 });
  const threads = await run({ operation: 'threads.list', propertyKey: 'anon' }) as Array<{ unread_count: number }>;
  assert.equal(threads[0].unread_count, 1);
  assert.equal(await run({ operation: 'messages.read', propertyKey: 'anon', data: { threadId: first, reader: 'host' } }), 1);
  assert.deepEqual(await sqlPadUnread(['anon']), {});
  const messages = await run({ operation: 'messages.list', propertyKey: 'anon', data: { threadId: first, limit: 1 } }, device) as Array<{ id: number; read_by_host_at: string }>;
  assert.equal(messages.length, 1); assert.ok(messages[0].read_by_host_at);
  assert.equal((await run({ operation: 'messages.list', propertyKey: 'anon', data: { threadId: first, afterId: messages[0].id } }, device) as Array<{ id: number }>)[0].id, host.id);
  await assert.rejects(run({ operation: 'messages.list', propertyKey: 'unwadang', data: { threadId: first } }, { kind: 'staff', userId: 'root', propertyIds: null }), /대화를/);
  const nextDevice: PadActor = { kind: 'device', propertyId: 'p1', stay: { guestName: 'New Guest', checkIn: today, checkOut: tomorrow } };
  const second = await run(operation, nextDevice);
  assert.notEqual(first, second);
  assert.equal((await sql.query<{ count: number }>('SELECT count(*)::int AS count FROM welcomepad_message_threads WHERE is_active')).rows[0].count, 1);
  await assert.rejects(run({ operation: 'messages.list', propertyKey: 'anon', data: { threadId: first } }, nextDevice), /현재 투숙/);
  await assert.rejects(run({ operation: 'messages.send', propertyKey: 'anon', data: { threadId: first, sender: 'host', body: 'late' } }), /종료/);
});

test('device registration derives staff identity and rejects cross-business or global subscriptions', async () => {
  const registration = { operation: 'devices.upsert', data: { fcm_token: 'fixture-token', property_keys: ['anon'] } };
  await run(registration);
  await run({ ...registration, data: { ...registration.data, fcm_token: 'updated-fixture-token' } });
  const rows = (await sql.query<{ host_id: string; fcm_token: string }>('SELECT host_id,fcm_token FROM welcomepad_host_devices')).rows;
  assert.deepEqual(rows, [{ host_id: 'host-1', fcm_token: 'updated-fixture-token' }]);
  assert.equal((await run({ operation: 'devices.list', propertyKey: 'unwadang' }, service) as unknown[]).length, 0);
  for (const extra of [{ host_id: 'other-user' }, { property_keys: ['unwadang'] }, { property_keys: [] }]) await assert.rejects(run({ ...registration, data: { ...registration.data, ...extra } }), /권한|숙소/);
});

test('route enforces present stay for device chat and keeps unknown errors private', async () => {
  const headers = { authorization: `Bearer ${deviceToken}` };
  const active = await call({ operation: 'threads.active', propertyKey: 'anon' }, headers);
  assert.equal(active.status, 200); assert.equal(typeof active.body.data, 'number');
  db.booking = [];
  const current = await call({ operation: 'threads.current', propertyKey: 'anon' }, headers);
  assert.equal(current.status, 200); assert.equal(current.body.data, null);
  assert.equal((await call({ operation: 'messages.list', propertyKey: 'anon', data: { threadId: active.body.data } }, headers)).status, 409);
  actAsAdmin();
  prismaOverrides.$queryRawUnsafe = async () => { throw new Error('private-database-details'); };
  const error = await call({ operation: 'properties.list' }, { cookie: 'va_session=fixture' });
  assert.equal(error.status, 503); assert.ok(!JSON.stringify(error.body).includes('private-database-details'));
});

test('existing host chat switches to SQL and tells the browser to poll; staged Supabase behavior remains available', async () => {
  const threadId = await run({ operation: 'threads.active', propertyKey: 'anon' }, device) as number;
  await run({ operation: 'messages.send', propertyKey: 'anon', data: { threadId, sender: 'guest', body: 'fixture' } }, device);
  actAsManager(['p1']);
  const response = await hostThreads(new Request('http://localhost/api/welcomepad-chat/threads'), { params: Promise.resolve({}) }) as unknown as { status: number; body: { transport: string; threads: Array<{ id: number; unread: number }> } };
  assert.equal(response.status, 200); assert.equal(response.body.transport, 'polling');
  assert.equal(response.body.threads[0].id, threadId); assert.equal(response.body.threads[0].unread, 1);
  const savedFetch = globalThis.fetch, savedUrl = process.env.SUPABASE_URL, savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.BACKEND_DB_TRANSPORT;
    process.env.SUPABASE_URL = 'https://fixture.supabase.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key-'.repeat(6);
    globalThis.fetch = async url => { assert.match(String(url), /^https:\/\/fixture\.supabase\.invalid\/rest\/v1\/welcomepad_message_threads/); return Response.json([{ id: 123, property_key: 'anon' }]); };
    assert.equal((await listThreads(['anon']))[0].id, 123);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }
});
