import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '../generated/prisma/client';
import type { BackendIdentity } from '../packages/domain/identity/access';
import { BackendReadService } from '../packages/domain/reads/service';
import { MAX_READ_ROWS } from '../packages/domain/reads/policy';
import { projectStays, attachCleaning, projectCleaning, type BookingReadRow, type CleaningReadRow, type EventReadRow } from '../packages/domain/reads/projections';

type Row = Record<string, unknown>;
const clock = () => new Date('2026-10-01T15:05:00.000Z');
const organization = { id: 'org-a', name: '운와', status: 'active', features: {} };

function identity(role: BackendIdentity['role'] = 'admin', grants: unknown = null): BackendIdentity {
  return { role, isAdmin: role === 'super_admin', isBusinessAdmin: role === 'admin', organizationId: organization.id,
    organizationFeatures: organization.features, organizationStatus: organization.status,
    session: { userId: 'user-a', email: 'staff@example.test', expiresAt: 2_000_000_000 },
    user: { id: 'user-a', email: 'staff@example.test', displayName: '직원', role, status: 'active', organizationId: organization.id,
      enabledModules: grants, accessVersion: 1, organization, properties: [] } };
}

function property(id = 'p-a', extra: Row = {}): Row {
  return { id, name: '안온재', timezone: 'Asia/Seoul', organizationId: organization.id, organization,
    status: 'active', featureOverrides: {}, featureVersion: 1, users: [{ userId: 'user-a' }], ...extra };
}

function event(extra: Partial<EventReadRow> = {}): EventReadRow & { tags: string[] } {
  return { id: 'e-a', propertyId: 'p-a', channelId: 'beds24', source: 'Airbnb', title: 'PRIVATE GUEST 예약',
    startDate: '2026-09-30', endDate: '2026-10-02', type: 'reservation', originalUid: 'b24-a', numAdults: 2, numChildren: 0,
    tags: [], ...extra };
}

function booking(extra: Partial<BookingReadRow> = {}): BookingReadRow & { status: string } {
  return { id: 'b-a', propertyId: 'p-a', name: 'PRIVATE GUEST', checkIn: '2026-09-30', checkOut: '2026-10-02',
    guests: 2, source: 'direct', channelBookingRef: 'b24-a', status: 'confirmed',
    checkout: { beds24Id: 'b24-a', stayOptions: { version: 1, pets: 1 } }, ...extra };
}

function cleaning(extra: Partial<CleaningReadRow> = {}): CleaningReadRow {
  return { id: 'c-a', propertyId: 'p-a', date: '2026-10-02', cleanerId: 'cleaner-a', status: 'pending', origin: 'auto',
    cleaner: { displayName: '현정' }, externalCleanerName: null, ...extra };
}

type SqlTruth = boolean | null;
const sqlAnd = (values: SqlTruth[]): SqlTruth => values.includes(false) ? false : values.includes(null) ? null : true;
const sqlOr = (values: SqlTruth[]): SqlTruth => values.includes(true) ? true : values.includes(null) ? null : false;

function matches(row: Row, where: Row): SqlTruth {
  return sqlAnd(Object.entries(where).map(([key, condition]) => {
    if (key === 'AND') return sqlAnd((Array.isArray(condition) ? condition : [condition]).map(part => matches(row, part)));
    if (key === 'OR') return sqlOr((condition as Row[]).map(part => matches(row, part)));
    if (key === 'NOT') return sqlAnd((Array.isArray(condition) ? condition : [condition]).map(part => {
      const value = matches(row, part);
      return value === null ? null : !value;
    }));
    const actual = row[key];
    if (condition === null || typeof condition !== 'object') return actual === condition;
    const operators = condition as Row;
    return sqlAnd(Object.entries(operators).map(([operator, expected]) => {
      if (operator === 'some') return Array.isArray(actual) && actual.some(item => matches(item, expected as Row));
      if (actual === null || actual === undefined) return null;
      if (operator === 'in') return (expected as unknown[]).includes(actual);
      if (operator === 'gte') return String(actual) >= String(expected);
      if (operator === 'lte') return String(actual) <= String(expected);
      if (operator === 'gt') return String(actual) > String(expected);
      if (operator === 'has') return Array.isArray(actual) && actual.includes(expected);
      if (operator === 'startsWith') return typeof actual === 'string' && actual.startsWith(String(expected));
      return !!actual && typeof actual === 'object' && matches(actual as Row, operators);
    }));
  }));
}

function project(row: Row, select: Row): Row {
  return Object.fromEntries(Object.entries(select).filter(([, selected]) => !!selected).map(([key, selected]) => {
    if (selected === true) return [key, row[key]];
    const nested = (selected as { select: Row }).select;
    if (Array.isArray(row[key])) {
      const options = selected as { where?: Row; take?: number; select: Row };
      const related = (row[key] as Row[]).filter(item => !options.where || matches(item, options.where));
      return [key, related.slice(0, options.take ?? related.length).map(item => project(item, nested))];
    }
    return [key, row[key] ? project(row[key] as Row, nested) : null];
  }));
}

function fixture(tables: { property?: Row[]; event?: unknown[]; booking?: unknown[]; cleaning?: unknown[]; user?: Row[] } = {}) {
  const calls: Array<{ model: string; args: Row }> = [];
  const transactionOptions: Row[] = [];
  const tx = Object.fromEntries(['property', 'event', 'booking', 'cleaning', 'user'].map(model => [model, {
    findMany: async (args: { where: Row; select: Row; take: number; orderBy: Row[] }) => {
      calls.push({ model, args });
      assert.ok(Number.isInteger(args.take) && args.take > 0 && args.take <= MAX_READ_ROWS + 1);
      const rows = ((tables as Record<string, Row[]>)[model] ?? []).filter(row => matches(row, args.where));
      rows.sort((a, b) => {
        for (const order of Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) for (const [key, direction] of Object.entries(order)) {
          if (a[key] === b[key]) continue;
          return (String(a[key]) > String(b[key]) ? 1 : -1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
      });
      return rows.slice(0, args.take).map(row => project(row, args.select));
    },
  }]));
  const db = { $transaction: async (read: (client: unknown) => Promise<unknown>, options: Row) => {
    transactionOptions.push(options);
    return read(tx);
  } } as unknown as Pick<PrismaClient, '$transaction'>;
  return { service: new BackendReadService(db, { now: clock }), calls, transactionOptions };
}

test('bootstrap uses paged summaries scoped to the business and does not read reservations', async () => {
  const fx = fixture({ property: [property('p-b'), property('p-a'), property('foreign', { organizationId: 'org-b' })] });
  const first = await fx.service.bootstrap(identity(), { limit: 1 });
  assert.deepEqual(first.properties.map(row => row.id), ['p-a']);
  assert.equal(first.propertiesPage.hasMore, true);
  assert.ok(first.capabilities.includes('operations.calendar.read'));
  const second = await fx.service.properties(identity(), { limit: 1, cursor: first.propertiesPage.nextCursor! });
  assert.deepEqual(second.properties.map(row => row.id), ['p-b']);
  assert.equal(second.propertiesPage.hasMore, false);
  assert.equal(second.propertiesPage.nextCursor, null);
  assert.deepEqual(fx.calls.map(call => call.model), ['property', 'property']);
  assert.equal(fx.calls[0].args.take, 2);
});

test('new workflow capabilities follow role, menu grants, business features and property switches', async () => {
  const cleaner = identity('cleaner');
  const fx = fixture({ property: [property()] });
  const cleanerInfo = await fx.service.bootstrap(cleaner);
  for (const capability of ['inventory.record', 'laundry.record', 'supplies.request']) assert.ok(cleanerInfo.capabilities.includes(capability));
  for (const capability of ['reservations.read', 'guests.read', 'staff.manage', 'settlement.read', 'supplies.manage', 'laundry.manage', 'jongno-events.manage']) assert.equal(cleanerInfo.capabilities.includes(capability), false, capability);
  const manager = identity('manager', ['staff', 'inventory', 'settlement']);
  const managerInfo = await fx.service.bootstrap(manager);
  assert.ok(managerInfo.capabilities.includes('staff.manage'));
  assert.ok(managerInfo.capabilities.includes('settlement.read'));
  assert.equal(managerInfo.capabilities.includes('staff.access.manage'), false);
  assert.equal(managerInfo.capabilities.includes('reservations.read'), false);
  const propertyDisabled = fixture({ property: [property('p-a', { featureOverrides: { settlement: false } })] });
  const disabled = await propertyDisabled.service.bootstrap(identity());
  assert.equal(disabled.capabilities.includes('settlement.read'), false);
  assert.equal(disabled.properties[0].capabilities.includes('settlement.read'), false);
  const organizationDisabled = identity();
  organizationDisabled.organizationFeatures = { inventory: false, settlement: false };
  const organizationInfo = await fx.service.bootstrap(organizationDisabled);
  assert.equal(organizationInfo.capabilities.includes('inventory.record'), false);
  assert.equal(organizationInfo.capabilities.includes('settlement.read'), false);
  const superInfo = await fx.service.bootstrap(identity('super_admin'));
  assert.ok(superInfo.capabilities.includes('jongno-events.manage'));
  assert.ok(superInfo.capabilities.includes('staff.access.manage'));
});

test('cursor cannot cross identities, expire, or survive changed menu grants', async () => {
  const fx = fixture({ property: [property('p-a'), property('p-b')] });
  const staff = identity('manager', ['reservations']);
  const first = await fx.service.properties(staff, { limit: 1 });
  const changed = identity('manager', ['cleaning']);
  await assert.rejects(() => fx.service.properties(changed, { cursor: first.propertiesPage.nextCursor! }), { code: 'INVALID_CURSOR' });
  const cursor = JSON.parse(Buffer.from(first.propertiesPage.nextCursor!, 'base64url').toString('utf8'));
  cursor.expiresAt = clock().getTime() - 1;
  await assert.rejects(() => fx.service.properties(staff, { cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url') }), { code: 'INVALID_CURSOR' });
});

test('unassigned administrators have no properties, and managers require both assignment and business membership', async () => {
  const fx = fixture({ property: [property(), property('other-assignee', { users: [{ userId: 'user-b' }] }),
    property('moved', { organizationId: 'org-b' })] });
  const admin = identity();
  admin.organizationId = admin.user.organizationId = null;
  assert.deepEqual((await fx.service.bootstrap(admin)).properties, []);
  assert.deepEqual((await fx.service.bootstrap(identity('manager'))).properties.map(row => row.id), ['p-a']);
  await assert.rejects(() => fx.service.calendar(identity('manager'), { propertyIds: ['moved'] }), { status: 404 });
  await assert.rejects(() => fx.service.calendar(identity('manager'), { propertyIds: ['other-assignee'] }), { status: 404 });
});

test('inactive accounts and organizations fail before business data is read', async () => {
  const fx = fixture({ property: [property()] });
  const suspended = identity();
  suspended.user.status = 'suspended';
  await assert.rejects(() => fx.service.bootstrap(suspended), { status: 401 });
  const inactive = identity();
  inactive.organizationStatus = 'suspended';
  await assert.rejects(() => fx.service.bootstrap(inactive), { status: 403 });
  assert.equal(fx.calls.length, 0);
});

test('cleaner projection excludes guest names, contacts, channels and administrative calendar access', async () => {
  const fx = fixture({ property: [property('p-a', { doorPassword: 'SECRET' })], event: [{ ...event(), guestEmail: 'private@example.test', guestPhone: '010-1234-5678', description: 'PRIVATE NOTES' }],
    booking: [booking()], cleaning: [cleaning()] });
  const cleaner = identity('cleaner');
  await assert.rejects(() => fx.service.calendar(cleaner, { month: '2026-10' }), { status: 403 });
  await assert.rejects(() => fx.service.today(cleaner), { status: 403 });
  const result = await fx.service.calendar(cleaner, { month: '2026-10', cleaner: true });
  assert.equal(result.stays.length, 1);
  assert.equal(result.stays[0].label, '투숙 일정');
  assert.equal(result.stays[0].channel, null);
  assert.deepEqual(result.cleanings[0].assignee, { id: 'cleaner-a', name: '현정' });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|private@example|010-1234/);
  for (const call of fx.calls) assert.doesNotMatch(JSON.stringify(call.args.select), /guestEmail|guestPhone|doorPassword|description/);
});

test('empty grants and disabled business options cannot be revived by property overrides', async () => {
  const fx = fixture({ property: [property('p-a', { featureOverrides: { cleaning: true } })] });
  await assert.rejects(() => fx.service.calendar(identity('manager', [])), { status: 403 });
  const cleaner = identity('cleaner');
  cleaner.organizationFeatures = { cleaning: false };
  await assert.rejects(() => fx.service.calendar(cleaner, { cleaner: true }), { status: 403 });
  assert.equal(fx.calls.length, 0);
});

test('calendar uses a repeatable snapshot and retains October checkout assignments in September', async () => {
  const fx = fixture({ property: [property()], event: [event()], cleaning: [cleaning()] });
  const september = await fx.service.calendar(identity(), { month: '2026-09' });
  const october = await fx.service.calendar(identity(), { month: '2026-10' });
  assert.equal(september.stays[0].cleaningId, 'c-a');
  assert.equal(october.stays[0].cleaningId, 'c-a');
  assert.deepEqual(september.cleanings, october.cleanings);
  assert.deepEqual([october.rangeFrom, october.rangeTo], ['2026-09-27', '2026-11-01']);
  assert.equal(october.linkedCheckoutCleaningsIncluded, true);
  assert.equal(october.complete, true);
  for (const options of fx.transactionOptions) assert.equal(options.isolationLevel, 'RepeatableRead');
});

test('a visible long stay keeps its checkout cleaning beyond the grid and 43-day grids are accepted', async () => {
  const fx = fixture({ property: [property()], event: [event({ startDate: '2026-08-01', endDate: '2026-11-05' })],
    cleaning: [cleaning({ date: '2026-11-05' })] });
  const result = await fx.service.calendar(identity(), { month: '2026-08' });
  assert.deepEqual([result.rangeFrom, result.rangeTo], ['2026-07-26', '2026-09-06']);
  assert.equal(result.stays[0].checkOut, '2026-11-05');
  assert.equal(result.stays[0].cleaningId, 'c-a');
});

test('calendar excludes inquiries and cancelled direct bookings', async () => {
  const fx = fixture({ property: [property()], event: [event({ id: 'real' }), { ...event({ id: 'inquiry' }), tags: ['inquiry'] }, event({ id: 'old-inquiry', title: '[문의] guest' })],
    booking: [{ ...booking({ id: 'cancelled', channelBookingRef: null, checkout: null }), status: 'cancelled' }] });
  assert.deepEqual((await fx.service.calendar(identity(), { month: '2026-10' })).stays.map(stay => stay.sourceId), ['real']);
});

test('valid reservations with a null title remain in today and calendar while null-title inquiries stay excluded', async () => {
  const fx = fixture({ property: [property()], event: [event({ id: 'unnamed', title: null }),
    { ...event({ id: 'null-inquiry', title: null }), tags: ['inquiry'] }, event({ id: 'named-inquiry', title: '[문의] guest' })] });
  const calendar = await fx.service.calendar(identity(), { month: '2026-10' });
  assert.deepEqual(calendar.stays.map(stay => stay.sourceId), ['unnamed']);
  assert.equal(calendar.stays[0].label, '게스트');
  const today = await fx.service.today(identity());
  assert.deepEqual(today.properties[0].checkouts.map(stay => stay.sourceId), ['unnamed']);
});

test('reservation-only accounts receive no cleaning state and are told the section is not permitted', async () => {
  const fx = fixture({ property: [property()], event: [event()], cleaning: [cleaning()] });
  const result = await fx.service.calendar(identity('manager', ['reservations']), { month: '2026-10' });
  assert.deepEqual(result.cleanings, []);
  assert.equal(result.stays[0].cleaningMatch, 'not_permitted');
  assert.equal(result.linkedCheckoutCleaningsIncluded, false);
  assert.equal(fx.calls.some(call => call.model === 'cleaning'), false);
});

test('oversized scopes and row sets fail instead of returning partial unassigned calendars', async () => {
  const tooManyProperties = fixture({ property: Array.from({ length: 21 }, (_, index) => property(`p-${index}`)) });
  await assert.rejects(() => tooManyProperties.service.calendar(identity(), { month: '2026-10' }), { code: 'RANGE_TOO_LARGE' });
  assert.deepEqual(tooManyProperties.calls.map(call => call.model), ['property']);
  const fx = fixture({ property: [property()], event: Array.from({ length: MAX_READ_ROWS }, (_, index) => event({ id: `e-${index}` })), cleaning: [cleaning()] });
  await assert.rejects(() => fx.service.calendar(identity(), { month: '2026-10' }), { code: 'RANGE_TOO_LARGE' });
  assert.equal(fx.calls.find(call => call.model === 'cleaning')?.args.take, 1);
});

test('today defaults to the Korea date and limits the result to that day while keeping pets', async () => {
  const fx = fixture({ property: [property()], event: [event(), event({ id: 'future', startDate: '2026-10-03', endDate: '2026-10-04' })], booking: [booking()], cleaning: [cleaning()] });
  const result = await fx.service.today(identity());
  assert.equal(result.date, '2026-10-02');
  assert.equal(result.properties[0].checkouts.length, 1);
  assert.equal(result.properties[0].checkouts[0].pets, 1);
  assert.deepEqual(result.properties[0].checkins, []);
  assert.ok(result.deferredSections.includes('conversation'));
  await assert.rejects(() => fx.service.today(identity(), { date: '2026-02-30' }), { code: 'INVALID_DATE' });
});

test('today marks future checkout cleaning as deferred rather than falsely unassigned', async () => {
  const fx = fixture({ property: [property()], event: [event({ startDate: '2026-10-02', endDate: '2026-10-05' })] });
  const result = await fx.service.today(identity());
  assert.equal(result.properties[0].checkins[0].cleaningMatch, 'deferred');
});

test('only explicit provider identity deduplicates bookings; same dates alone never hide a stay', () => {
  const rows = projectStays([event()], [booking(), booking({ id: 'different', channelBookingRef: null, checkout: null })], false);
  assert.deepEqual(rows.map(row => row.sourceId), ['different', 'e-a']);
  assert.equal(rows.find(row => row.sourceType === 'event')?.pets, 1);
});

test('ambiguous cleaning records remain visible without choosing an arbitrary assignee', () => {
  const stays = projectStays([event()], [], false);
  attachCleaning(stays, [cleaning(), cleaning({ id: 'c-b', cleanerId: 'cleaner-b' })], new Set(['p-a']));
  assert.equal(stays[0].cleaningId, null);
  assert.equal(stays[0].cleaningMatch, 'ambiguous');
  const external = projectCleaning(cleaning({ cleanerId: null, cleaner: null, externalCleanerName: '외부 파트너' }));
  assert.deepEqual(external.assignee, { id: null, name: '외부 파트너' });
});

test('staff pages remain tenant scoped and never return passwords or unrelated assignments', async () => {
  const own = { id: 'u-a', displayName: '직원', email: 'staff@example.test', role: 'manager', status: 'active', organizationId: 'org-a', organization,
    passwordHash: 'SECRET', properties: [{ property: property() }, { property: property('other', { organizationId: 'org-b' }) }] };
  const fx = fixture({ user: [own, { ...own, id: 'u-b' }, { ...own, id: 'foreign', organizationId: 'org-b' }, { ...own, id: 'super', role: 'super_admin' }] });
  const first = await fx.service.staff(identity(), { limit: 1 });
  assert.deepEqual(first.staff.map(user => user.id), ['u-a']);
  assert.deepEqual(first.staff[0].properties.map(item => item.id), ['p-a']);
  assert.equal(first.staffPage.hasMore, true);
  const second = await fx.service.staff(identity(), { cursor: first.staffPage.nextCursor!, limit: 1 });
  assert.deepEqual(second.staff.map(user => user.id), ['u-b']);
  assert.equal(second.staffPage.hasMore, false);
  assert.doesNotMatch(JSON.stringify(first), /passwordHash|SECRET/);
  await assert.rejects(() => fx.service.staff(identity(), { organizationId: 'org-b' }), { status: 404 });
  await assert.rejects(() => fx.service.staff(identity('cleaner')), { status: 403 });
});

test('a manager can list staff only on assigned properties that allow the staff module', async () => {
  const ownProperty = property();
  const otherProperty = property('other', { users: [{ userId: 'other-user' }] });
  const base = { displayName: '직원', email: 'staff@example.test', role: 'cleaner', status: 'active', organizationId: 'org-a', organization };
  const fx = fixture({ user: [{ ...base, id: 'assigned', properties: [{ property: ownProperty }] },
    { ...base, id: 'other', properties: [{ property: otherProperty }] },
    { ...base, id: 'admin', role: 'admin', properties: [{ property: ownProperty }] }] });
  const manager = identity('manager');
  manager.user.properties = [{ propertyId: 'p-a', property: ownProperty as unknown as BackendIdentity['user']['properties'][number]['property'] }];
  assert.deepEqual((await fx.service.staff(manager)).staff.map(user => user.id), ['assigned']);
  manager.user.properties[0].property.featureOverrides = { staff: false };
  assert.deepEqual((await fx.service.staff(manager)).staff, []);
});

test('cancelled automatic cleaning never appears as pending work in today or the calendar', async () => {
  const fx = fixture({ property: [property()], cleaning: [cleaning({ status: 'cancelled' })] });
  const today = await fx.service.today(identity(), { date: '2026-10-02' });
  assert.equal(today.properties[0].hasWork, false);
  assert.deepEqual(today.properties[0].cleanings, []);
  const calendar = await fx.service.calendar(identity(), { month: '2026-10' });
  assert.deepEqual(calendar.cleanings, []);
});
