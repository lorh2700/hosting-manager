import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { parseJongnoEventInput, parseJongnoEventQuery, isJongnoDate, jongnoToday, eventOccursOn, eventHasOccurrenceInRange } from '../lib/jongno-events';
import { prepareJongnoImage, readJongnoImageBody, JONGNO_IMAGE_MAX_BYTES } from '../lib/jongno-event-image';
import { GET as publicGET } from '../app/api/public/jongno-events/route';
import { GET as adminGET, POST } from '../app/api/admin/jongno-events/route';
import { GET as itemGET, PATCH } from '../app/api/admin/jongno-events/[id]/route';
import { POST as imagePOST } from '../app/api/uploads/jongno-event-image/route';
import { db, prisma, prismaOverrides, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsAnonymous, actAsManager, actAsCleaner } from './stubs/auth';
import type { StubResponse } from './stubs/next-server';

const context = (id = 'e1') => ({ params: Promise.resolve({ id }) });
const request = (suffix = '', body?: unknown, method = 'GET') => new Request(`https://example.com/api/jongno-events${suffix}`, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const cast = (response: unknown) => response as StubResponse;
const input = (over: Record<string, unknown> = {}) => ({
  titleKo: '종로 행사', category: 'exhibition', area: 'bukchon', startDate: '2026-09-29', endDate: '2026-10-04',
  excludedWeekdays: [1], excludedDates: ['2026-10-02'], officialUrl: 'https://culture.jongno.go.kr/media/ko/index.do',
  verifiedAt: '2026-09-20T00:00:00.000Z', ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ ...parseJongnoEventInput(input()), id: 'e1',
  verifiedAt: new Date('2026-09-20T00:00:00Z'), version: 1, updatedAt: new Date('2026-09-20T00:00:00Z'), createdBy: 'private-editor', ...over });

beforeEach(() => { resetDb(); actAsAdmin(); db.jongnoEvent = [row({ status: 'published' })]; });

test('civil dates validate leap years, invalid days and Seoul midnight correctly', () => {
  assert.equal(isJongnoDate('2028-02-29'), true);
  for (const date of ['2026-02-29', '2026-09-31', '2026-13-01', '2026-9-01', '9999-12-01']) assert.equal(isJongnoDate(date), false);
  assert.equal(jongnoToday(new Date('2026-09-30T15:00:00Z')), '2026-10-01');
});
test('actual event days include boundaries and respect weekday and date closures', () => {
  const event = parseJongnoEventInput(input());
  assert.equal(eventOccursOn(event, '2026-09-29'), true);
  assert.equal(eventOccursOn(event, '2026-10-04'), true);
  assert.equal(eventOccursOn(event, '2026-10-02'), false);
  assert.equal(eventOccursOn({ ...event, endDate: '2026-10-05' }, '2026-10-05'), false);
  assert.equal(eventHasOccurrenceInRange(event, '2026-10-02', '2026-10-02'), false);
  assert.equal(eventHasOccurrenceInRange(event, '2026-10-02', '2026-10-04'), true);
  assert.equal(eventHasOccurrenceInRange(event, '2026-10-05', '2026-10-06'), false);
});
test('publishing requires official source and explicit schedule confirmation', () => {
  assert.throws(() => parseJongnoEventInput(input({ status: 'published', officialUrl: '' })), /공식 안내/);
  assert.throws(() => parseJongnoEventInput(input({ status: 'published', verifiedAt: null })), /공식 일정/);
  assert.throws(() => parseJongnoEventInput(input({ verifiedAt: '2199-01-01T00:00:00Z' })), /미래/);
  assert.equal(parseJongnoEventInput(input({ status: 'published' })).verifiedAt, '2026-09-20T00:00:00.000Z');
  assert.throws(() => parseJongnoEventInput(input({ status: 'published', excludedWeekdays: [0, 1, 2, 3, 4, 5, 6] })), /진행 날짜/);
  assert.equal(parseJongnoEventInput(input({ officialUrl: '', verifiedAt: null })).status, 'draft');
});
test('input rejects unsafe URLs, oversized galleries and invalid closures without guessing fees', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:secret@example.com']) assert.throws(() => parseJongnoEventInput(input({ bookingUrl: url })));
  assert.throws(() => parseJongnoEventInput(input({ images: Array.from({ length: 7 }, () => ({ url: 'https://example.com/a.webp' })) })), /6장/);
  assert.throws(() => parseJongnoEventInput(input({ excludedDates: ['2026-10-09'] })), /기간/);
  assert.throws(() => parseJongnoEventInput(input({ excludedWeekdays: ['1'] })), /요일/);
  assert.throws(() => parseJongnoEventInput(input({ endDate: '2026-09-20' })), /종료일/);
  assert.equal(parseJongnoEventInput(input()).feeType, 'unknown');
});
test('public queries are bounded and monthly ranges handle leap years and December', () => {
  const query = (search: string) => parseJongnoEventQuery(new URLSearchParams(search), true);
  assert.deepEqual(query('month=2028-02').range, { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(query('month=2026-12').range, { from: '2026-12-01', to: '2026-12-31' });
  for (const search of ['month=2026-13', 'month=2026-9', 'from=2026-10-01', 'from=2026-01-01&to=2026-12-31', 'limit=101', 'limit=-1', 'cursor=bad%20id', 'month=2026-10&from=2026-10-01&to=2026-10-02']) assert.throws(() => query(search));
});
test('public route exposes only published overlapping events, without editorial user IDs', async () => {
  actAsAnonymous();
  db.jongnoEvent.push(row({ id: 'draft', status: 'draft' }), row({ id: 'cancelled', status: 'cancelled' }), row({ id: 'outside', status: 'published', startDate: '2026-11-01', endDate: '2026-11-02' }));
  const response = cast(await publicGET(request('?month=2026-10&status=draft'), { params: Promise.resolve({}) }));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events.map((event: any) => event.id), ['e1']);
  assert.equal('createdBy' in response.body.events[0], false);
  assert.equal('createdAt' in response.body.events[0], false);
  assert.match(response.headers.get('Cache-Control') ?? '', /max-age=30/);
});
test('pagination limits database reads, filters category and area, and signals another page', async () => {
  db.jongnoEvent = Array.from({ length: 102 }, (_, i) => row({ id: `e-${String(i).padStart(3, '0')}`, status: 'published' }));
  const base = prisma.jongnoEvent; let args: any;
  prismaOverrides.jongnoEvent = { ...base, findMany: async (query: any) => { args = query; return base.findMany(query); } };
  const response = cast(await publicGET(request('?month=2026-10&category=exhibition&area=bukchon'), { params: Promise.resolve({}) }));
  assert.equal(args.take, 101);
  assert.deepEqual(args.orderBy, [{ startDate: 'asc' }, { id: 'asc' }]);
  assert.equal(args.where.status, 'published'); assert.equal(args.where.category, 'exhibition');
  assert.equal(response.body.events.length, 100); assert.equal(response.body.hasMore, true); assert.equal(response.body.nextCursor, 'e-099');
  await publicGET(request('?month=2026-10&cursor=e-099'), { params: Promise.resolve({}) });
  assert.deepEqual(args.cursor, { id: 'e-099' }); assert.equal(args.skip, 1);
});
test('all editorial and upload endpoints reject anonymous, manager and cleaner sessions', async () => {
  for (const act of [actAsAnonymous, () => actAsManager(['p1']), () => actAsCleaner(['p1'])]) {
    act(); const expected = act === actAsAnonymous ? 401 : 403;
    assert.equal(cast(await adminGET(request(), { params: Promise.resolve({}) })).status, expected);
    assert.equal(cast(await POST(request('', input(), 'POST'), { params: Promise.resolve({}) })).status, expected);
    assert.equal(cast(await itemGET(request(), context())).status, expected);
    assert.equal(cast(await PATCH(request('', { ...input(), version: 1 }, 'PATCH'), context())).status, expected);
    assert.equal(cast(await imagePOST(request('', {}, 'POST'), { params: Promise.resolve({}) })).status, expected);
  }
});
test('admin creation accepts draft photos and keeps creator out of response', async () => {
  const base = prisma.jongnoEvent;
  prismaOverrides.jongnoEvent = { ...base, create: (args: any) => base.create({ data: { ...args.data, version: 1, updatedAt: new Date() } }) };
  const response = cast(await POST(request('', input({ images: [{ url: 'https://example.com/a.webp', alt: '행사 포스터', credit: '행사 주최자' }] }), 'POST'), { params: Promise.resolve({}) }));
  assert.equal(response.status, 201); assert.equal(response.body.event.images[0].alt, '행사 포스터');
  assert.equal(db.jongnoEvent.at(-1)?.createdBy, 'admin-1'); assert.equal('createdBy' in response.body.event, false);
});
test('version conflict preserves changes; fresh save increments version and unpublishes', async () => {
  const original = prisma.jongnoEvent;
  prismaOverrides.jongnoEvent = { ...original, updateMany: async (args: any) => original.updateMany({ ...args, data: { ...args.data, version: args.where.version + 1 } }) };
  const saved = cast(await PATCH(request('', { ...input({ titleKo: '수정 행사', status: 'cancelled' }), version: 1 }, 'PATCH'), context()));
  assert.equal(saved.status, 200); assert.equal(saved.body.event.version, 2);
  const conflict = cast(await PATCH(request('', { ...input({ titleKo: '오래된 수정' }), version: 1 }, 'PATCH'), context()));
  assert.equal(conflict.status, 409); assert.equal(db.jongnoEvent[0].titleKo, '수정 행사');
  assert.equal(cast(await itemGET(request(), context())).body.event.version, 2);
  assert.deepEqual(cast(await publicGET(request('?month=2026-10'), { params: Promise.resolve({}) })).body.events, []);
  assert.equal(cast(await PATCH(request('', { ...input(), version: 1 }, 'PATCH'), context('missing'))).status, 404);
});
test('unprepared storage returns actionable 503 and malformed input returns 400', async () => {
  assert.equal(cast(await POST(request('', input({ startDate: '2026-09-31' }), 'POST'), { params: Promise.resolve({}) })).status, 400);
  prismaOverrides.jongnoEvent = { findMany: async () => { throw Object.assign(new Error('missing'), { code: 'P2021' }); } };
  const response = cast(await publicGET(request('?month=2026-10'), { params: Promise.resolve({}) }));
  assert.equal(response.status, 503); assert.match(response.body.error, /저장소 준비/);
});
test('image processing decodes input, scales dimensions, strips metadata and creates WebP', async () => {
  const original = await sharp({ create: { width: 2200, height: 1200, channels: 3, background: '#ddccaa' } }).withMetadata({ exif: { IFD0: { Artist: 'Private phone owner' } } }).jpeg().toBuffer();
  const compressed = await prepareJongnoImage(original, 'image/jpeg');
  const metadata = await sharp(compressed.buffer).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(compressed.width, 1600); assert.ok(compressed.height <= 1600);
  assert.equal(metadata.exif, undefined); assert.ok(compressed.bytes < original.byteLength);
});
test('image validation rejects spoofed signatures, broken files and declared oversized input', async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(prepareJongnoImage(png, 'image/jpeg'));
  await assert.rejects(prepareJongnoImage(Buffer.from('<svg></svg>'), 'image/png'));
  await assert.rejects(prepareJongnoImage(Buffer.from([255, 216, 255, 0, 0]), 'image/jpeg'));
  await assert.rejects(readJongnoImageBody(new Request('https://example.com', { method: 'POST', headers: { 'Content-Length': String(JONGNO_IMAGE_MAX_BYTES + 1) }, body: 'a' })), /8MB/);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(JONGNO_IMAGE_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  await assert.rejects(readJongnoImageBody(new Request('https://example.com', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)), /8MB/);
});
test('image endpoint sends rebuilt WebP to storage with a timeout and no original filename', async () => {
  const previousFetch = globalThis.fetch, previousUrl = process.env.SUPABASE_URL, previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let upload: { url: string; init?: RequestInit } | undefined;
  process.env.SUPABASE_URL = 'https://test-storage.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(100);
  globalThis.fetch = async (url, init) => { upload = { url: String(url), init }; return new Response('{}', { status: 200 }); };
  try {
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ddd' } }).png().toBuffer();
    const response = cast(await imagePOST(new Request('https://example.com/api/uploads/jongno-event-image', { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-filename': 'private-phone-name.png' }, body: Uint8Array.from(png) }), { params: Promise.resolve({}) }));
    assert.equal(response.status, 201); assert.equal(response.body.width, 200);
    assert.match(response.body.url, /^https:\/\/test-storage\.supabase\.co\/storage\/v1\/object\/public\/.+\.webp$/);
    assert.ok(upload); assert.equal(new Headers(upload.init?.headers).get('Content-Type'), 'image/webp');
    assert.ok(upload.init?.signal instanceof AbortSignal); assert.equal(upload.url.includes('private-phone-name'), false);
    assert.equal((await sharp(upload.init?.body as ArrayBuffer).metadata()).format, 'webp');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
test('new table migration is additive, hides drafts from client roles, and enforces editorial constraints', async () => {
  const sql = new PGlite();
  try {
    await sql.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE existing_reservations(id TEXT); INSERT INTO existing_reservations VALUES (\'keep\');');
    await sql.exec(await readFile(new URL('../prisma/migrations/20261002020000_jongno_events/migration.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await sql.query('SELECT * FROM existing_reservations')).rows, [{ id: 'keep' }]);
    const rls = (await sql.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='jongno_events'")).rows[0];
    assert.equal(rls.relrowsecurity, true);
    const permissions = (await sql.query<{ anon: boolean; authenticated: boolean }>("SELECT has_table_privilege('anon','jongno_events','SELECT') AS anon,has_table_privilege('authenticated','jongno_events','UPDATE') AS authenticated")).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false });
    const insert = "INSERT INTO jongno_events(id,title_ko,category,area,start_date,end_date,created_by) VALUES ('a','행사','festival','bukchon','2026-10-01','2026-10-02','admin')";
    await sql.exec(insert);
    await assert.rejects(sql.exec("UPDATE jongno_events SET status='published' WHERE id='a'"));
    await assert.rejects(sql.exec("UPDATE jongno_events SET end_date='2026-09-31' WHERE id='a'"));
    await sql.exec("UPDATE jongno_events SET status='published',official_url='https://example.com',verified_at=CURRENT_TIMESTAMP WHERE id='a'");
  } finally { await sql.close(); }
});
