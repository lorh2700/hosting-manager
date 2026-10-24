import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import type { BackendIdentity } from '../packages/domain/identity/access';
import { createPeopleEventsService } from '../packages/domain/people-events/service';
import { createEventImageUploader, validateEventImage, type EventImageStorage } from '../packages/domain/people-events/images';
import type { PeopleEventsDatabase } from '../packages/data/people-events-repository';
import { db, prisma, prismaOverrides, resetDb } from './stubs/prisma';

type Row = Record<string, any>;
const organization = { id: 'org-a', name: '예시 사업자', status: 'active', features: {} };
function actor(role: BackendIdentity['role'] = 'manager'): BackendIdentity {
  return { role, isAdmin: role === 'super_admin', isBusinessAdmin: role === 'admin', organizationId: 'org-a', organizationStatus: 'active', organizationFeatures: {},
    session: { userId: 'manager-a', email: 'manager@example.invalid', expiresAt: 2000000000 },
    user: { id: 'manager-a', email: 'manager@example.invalid', displayName: '예시 관리자', role, status: 'active', organizationId: 'org-a', enabledModules: ['staff'],
      organization, accessVersion: 1, properties: [{ propertyId: 'p-a', property: { id: 'p-a', organizationId: 'org-a', organization, featureOverrides: {} } }] } };
}
const service = () => createPeopleEventsService({ database: prisma as PeopleEventsDatabase, transaction: handler => prisma.$transaction(handler), legacyOrigin: 'https://example.invalid' });

function compare(actual: unknown, condition: any): boolean {
  if (condition === null || typeof condition !== 'object') return actual === condition;
  if ('in' in condition && !condition.in.includes(actual)) return false;
  if ('not' in condition && actual === condition.not) return false;
  if ('gt' in condition && !(String(actual) > String(condition.gt))) return false;
  return true;
}
function scopedMatch(row: Row, where: Row, model: string): boolean {
  return Object.entries(where || {}).every(([key, condition]) => {
    if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every(part => scopedMatch(row, part, model));
    if (key === 'OR') return (condition as Row[]).some(part => scopedMatch(row, part, model));
    if (key === 'NOT') return !scopedMatch(row, condition, model);
    if (key === 'users' && condition.some) return (db.userProperty || []).filter(item => item.propertyId === row.id).some(item => scopedMatch(item, condition.some, 'userProperty'));
    if (key === 'properties' && condition.some) return (db.userProperty || []).filter(item => item.userId === row.id).some(item => scopedMatch(item, condition.some, 'userProperty'));
    if (key === 'property') return scopedMatch(db.property.find(item => item.id === row.propertyId) || {}, condition, 'property');
    return compare(row[key], condition);
  });
}

beforeEach(() => {
  resetDb();
  db.organization = [organization, { id: 'org-b', name: '다른 사업자', status: 'active', features: {} }];
  db.property = [{ id: 'p-a', name: '허용 숙소', organizationId: 'org-a', organization, featureOverrides: {} },
    { id: 'p-other', name: '다른 담당 숙소', organizationId: 'org-a', organization, featureOverrides: {} },
    { id: 'p-b', name: '다른 사업자 숙소', organizationId: 'org-b', organization: db.organization[1], featureOverrides: {} }];
  db.user = [
    { id: 'manager-a', role: 'manager', email: 'manager@example.invalid', displayName: '예시 매니저', organizationId: 'org-a', status: 'active', accessVersion: 1, password: 'existing' },
    { id: 'own-unassigned', role: 'cleaner', email: '01011110001@cleaner.va', phone: '01011110001', displayName: '미배정 인력', organizationId: 'org-a', ownerId: 'manager-a', status: 'no_account', accessVersion: 1, password: '', publicToken: 'schedule-old' },
    { id: 'assigned', role: 'cleaner', email: '01011110002@cleaner.va', phone: '01011110002', displayName: '배정 인력', organizationId: 'org-a', ownerId: 'admin-a', status: 'active', accessVersion: 1, password: 'existing', publicToken: 'assigned-token' },
    { id: 'other-scope', role: 'cleaner', email: '01011110003@cleaner.va', phone: '01011110003', displayName: '다른 범위', organizationId: 'org-a', ownerId: 'admin-a', status: 'active', accessVersion: 1, password: 'existing' },
    { id: 'foreign', role: 'cleaner', email: '01011110004@cleaner.va', phone: '01011110004', displayName: '다른 사업자', organizationId: 'org-b', ownerId: 'manager-a', status: 'active', accessVersion: 1, password: 'existing' },
  ];
  db.userProperty = [{ userId: 'manager-a', propertyId: 'p-a' }, { userId: 'assigned', propertyId: 'p-a' }, { userId: 'other-scope', propertyId: 'p-other' }, { userId: 'foreign', propertyId: 'p-b' }];
  db.cleaning = [{ id: 'history', propertyId: 'p-a', cleanerId: 'assigned', status: 'done', date: '2026-09-25' }];
  db.invitation = [];
  for (const model of ['property', 'user']) {
    const base = prisma[model];
    prismaOverrides[model] = { ...base, findMany: (args: Row = {}) => base.findMany({ ...args, where: { id: { in: db[model].filter(row => scopedMatch(row, args.where, model)).map(row => row.id) } } }) };
  }
  const eventBase = prisma.jongnoEvent;
  prismaOverrides.jongnoEvent = { ...eventBase, create: (args: Row) => eventBase.create({ ...args, data: { version: 1, updatedAt: new Date(), ...args.data } }) };
});

test('manager list includes owned unassigned cleaners but excludes other organizations and assignments', async () => {
  const result = await service().listStaff(actor());
  assert.deepEqual(result.staff.map(user => user.id).sort(), ['assigned', 'manager-a', 'own-unassigned']);
  assert.deepEqual(result.properties.map(property => property.id), ['p-a']);
  assert.equal(result.staff.find(user => user.id === 'own-unassigned')?.canManage, true);
  assert.ok(!JSON.stringify(result).includes('password'));
  await assert.rejects(service().listStaff(actor(), { organizationId: 'org-b' }), { status: 404 });
  await assert.rejects(service().listStaff(actor(), { limit: 1000 }), { status: 400 });
});

test('staff creation validates role, tenant, property scope, duplicate phones and leaves an auditable user', async () => {
  const input = { name: '새 인력', phone: '+82 10-2222-3333', propertyIds: ['p-a'], loginEnabled: false };
  await assert.rejects(service().createCleaner(actor(), { ...input, organizationId: 'org-b' }), { status: 404 });
  await assert.rejects(service().createCleaner(actor(), { ...input, propertyIds: ['p-other'] }), { status: 404 });
  await assert.rejects(service().createCleaner(actor(), { ...input, role: 'manager' }), { status: 403 });
  const result = await service().createCleaner(actor(), input);
  assert.equal(result.staff.status, 'no_account');
  assert.equal(result.staff.phone, '01022223333');
  assert.equal(result.staff.organization?.id, 'org-a');
  assert.equal(result.initialPassword, null);
  assert.deepEqual(result.staff.properties.map(property => property.id), ['p-a']);
  assert.equal(db.auditLog.at(-1)?.action, 'staff.create');
  await assert.rejects(service().createCleaner(actor(), input), { status: 409 });
  const manager = await service().createCleaner(actor('admin'), { ...input, name: '새 매니저', phone: '01044445555', role: 'manager' });
  assert.equal(manager.staff.role, 'manager');
});

test('mutations and replay authorization reject foreign, shared-out-of-scope, disabled modules and role escalation', async () => {
  await assert.rejects(service().updateCleaner(actor(), 'foreign', { version: 1, name: '금지' }), { status: 404 });
  await assert.rejects(service().updateCleaner(actor('admin'), 'foreign', { version: 1, name: '금지' }), { status: 404 });
  await assert.rejects(service().updateCleaner(actor(), 'assigned', { version: 1, role: 'admin' }), { status: 400 });
  db.userProperty.push({ userId: 'assigned', propertyId: 'p-other' });
  await assert.rejects(service().authorizeCommand(actor(), 'updateCleaner', 'assigned', { version: 1, name: '금지' }), { status: 404 });
  await assert.rejects(service().getStaff(actor(), 'assigned'), { status: 404 });
  const off = actor(); off.user.enabledModules = [];
  await assert.rejects(service().listStaff(off), { status: 403 });
  db.property[0].featureOverrides = { staff: false };
  await assert.rejects(service().createCleaner(actor(), { name: '금지', phone: '01022223333', propertyIds: ['p-a'], loginEnabled: false }), { status: 404 });
});

test('retirement clears assignments, invites and personal links without erasing cleaning history; restore stays visible', async () => {
  db.invitation.push({ id: 'invite', cleanerId: 'assigned', status: 'pending' });
  const retired = await service().updateCleaner(actor(), 'assigned', { version: 1, status: 'suspended' });
  assert.equal(retired.staff.status, 'suspended');
  assert.deepEqual(retired.staff.properties, []);
  assert.equal(retired.staff.scheduleUrl, null);
  assert.equal(db.invitation[0].status, 'expired');
  assert.equal(db.cleaning[0].cleanerId, 'assigned');
  assert.equal((await service().listStaff(actor())).staff.find(user => user.id === 'assigned')?.status, 'suspended');
  const restored = await service().updateCleaner(actor(), 'assigned', { version: 2, status: 'active' });
  assert.equal(restored.staff.status, 'active');
  assert.equal(restored.staff.properties.length, 0);
  assert.notEqual(restored.staff.scheduleUrl, 'https://example.invalid/c/assigned-token');
  await service().updateCleaner(actor(), 'own-unassigned', { version: 1, status: 'suspended' });
  const noLogin = await service().updateCleaner(actor(), 'own-unassigned', { version: 2, status: 'active' });
  assert.equal(noLogin.staff.status, 'no_account');
});

test('stale profile updates fail and an audit failure rolls back the profile mutation', async () => {
  await service().updateCleaner(actor(), 'own-unassigned', { version: 1, name: '변경 이름', propertyIds: ['p-a'] });
  await assert.rejects(service().updateCleaner(actor(), 'own-unassigned', { version: 1, name: '덮어쓰기' }), { status: 409 });
  prismaOverrides.auditLog = { create: async () => { throw new Error('audit unavailable'); } };
  await assert.rejects(service().updateCleaner(actor(), 'own-unassigned', { version: 2, name: '롤백 대상' }), /audit unavailable/);
  assert.equal(db.user.find(user => user.id === 'own-unassigned')?.displayName, '변경 이름');
  assert.equal(db.user.find(user => user.id === 'own-unassigned')?.accessVersion, 2);
});

test('login credentials are hashed, invitations stay compatible and old schedule links are rotated', async () => {
  const result = await service().configureStaffLogin(actor(), 'own-unassigned', { version: 1, enabled: true });
  const stored = db.user.find(user => user.id === 'own-unassigned')!;
  assert.equal(result.staff.status, 'active');
  assert.notEqual(stored.password, result.initialPassword);
  assert.equal(await bcrypt.compare(result.initialPassword!, stored.password), true);
  assert.ok(!JSON.stringify(db.auditLog).includes(result.initialPassword!));
  await assert.rejects(service().inviteStaff(actor(), stored.id, { version: 2, email: 'cleaner@example.invalid' }), { status: 409 });
  await service().configureStaffLogin(actor(), stored.id, { version: 2, enabled: false });
  const invitation = await service().inviteStaff(actor(), stored.id, { version: 3, email: 'cleaner@example.invalid' });
  assert.match(invitation.invitationUrl, /^https:\/\/example\.invalid\/invite\//);
  assert.equal(db.invitation[0].cleanerId, stored.id);
  assert.equal(db.user.find(user => user.id === stored.id)?.status, 'no_account');
  const rotated = await service().rotateStaffSchedule(actor(), stored.id, { version: 3 });
  assert.notEqual(rotated.scheduleUrl, 'https://example.invalid/c/schedule-old');
});

function eventBody(extra: Row = {}) {
  return { titleKo: '예시 행사', category: 'festival', area: 'bukchon', startDate: '2026-10-10', endDate: '2026-10-11', ...extra };
}

test('event management stays super-only, validates publication and archives with optimistic concurrency', async () => {
  await assert.rejects(service().listJongnoEvents(actor('admin'), new URLSearchParams()), { status: 403 });
  await assert.rejects(service().createJongnoEvent(actor(), eventBody()), { status: 403 });
  const superUser = actor('super_admin');
  const result = await service().createJongnoEvent(superUser, eventBody());
  assert.equal(result.event.status, 'draft');
  await assert.rejects(service().updateJongnoEvent(superUser, result.event.id, eventBody({ version: 1, status: 'published' })), { status: 400 });
  const published = await service().updateJongnoEvent(superUser, result.event.id, eventBody({ version: 1, status: 'published', verifiedAt: new Date(Date.now() - 1000).toISOString(), officialUrl: 'https://example.invalid/event' }));
  assert.equal(published.event.version, 2);
  const list = await service().listJongnoEvents(superUser, new URLSearchParams('month=2026-10&limit=1'));
  assert.equal(list.events.length, 1);
  await assert.rejects(service().archiveJongnoEvent(superUser, result.event.id, { version: 1 }), { status: 409 });
  const archived = await service().archiveJongnoEvent(superUser, result.event.id, { version: 2 });
  assert.equal(archived.event.status, 'cancelled');
  assert.equal(db.auditLog.at(-1)?.action, 'jongno-event.archive');
});

async function imageBody(color = '#93604a') {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer();
  return { mimeType: 'image/png', data: bytes.toString('base64') };
}

test('image validation decodes pixels and rejects MIME spoofing, broken files and oversize input', async () => {
  const body = await imageBody();
  const result = await validateEventImage(body);
  const metadata = await sharp(Buffer.from(result.buffer)).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(validateEventImage({ ...body, mimeType: 'image/jpeg' }), { status: 400 });
  await assert.rejects(validateEventImage({ mimeType: 'image/png', data: Buffer.from('<svg></svg>').toString('base64') }), { status: 400 });
  await assert.rejects(validateEventImage({ mimeType: 'image/png', data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), { status: 413 });
  await assert.rejects(validateEventImage({ mimeType: 'image/png', data: body.data.slice(0, 32) }), { status: 400 });
});

test('image retry uses one immutable object and recovers an ambiguous stored response', async () => {
  const objects = new Map<string, Uint8Array>();
  let creates = 0;
  let ambiguous = false;
  const storage: EventImageStorage = {
    read: async path => objects.get(path) || null,
    create: async (path, bytes) => { creates++; if (objects.has(path)) return 'exists'; objects.set(path, bytes); if (ambiguous) { ambiguous = false; throw new Error('response lost'); } return 'created'; },
    url: path => `https://example.invalid/${path}`,
  };
  const upload = createEventImageUploader(storage);
  const body = await imageBody();
  const key = 'image-example-key-0001';
  const first = await upload(actor('super_admin'), key, body);
  const retry = await upload(actor('super_admin'), key, body);
  assert.equal(first.url, retry.url);
  assert.equal(creates, 1);
  await assert.rejects(upload(actor('super_admin'), key, await imageBody('#206a61')), { status: 409 });
  await assert.rejects(upload(actor('admin'), key, body), { status: 403 });
  ambiguous = true;
  await assert.rejects(upload(actor('super_admin'), 'image-example-key-0002', body), /response lost/);
  const recovered = await upload(actor('super_admin'), 'image-example-key-0002', body);
  assert.match(recovered.url, /\.webp$/);
  assert.equal(creates, 2);
});
