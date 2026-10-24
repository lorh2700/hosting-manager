import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { HttpError } from '../lib/core/errors';
import { createAccessRevisionReader, createIdentityRepository } from '../packages/data/identity-repository';
import {
  authenticateLegacySession,
  refreshBackendIdentity,
  resolveOperationalScope,
  type AccessOrganization,
  type AccessProperty,
  type AccessUser,
  type IdentityRepository,
} from '../packages/domain/identity/access';
import { readLegacySessionToken, verifyLegacySessionToken } from '../packages/domain/identity/legacy-session';
import { accessRevisionFor } from '../packages/domain/identity/revision';

const secret = 'backend-identity-fixture-secret-with-no-live-access';
const now = new Date('2026-10-05T00:00:00Z');
const expiresAt = now.getTime() / 1000 + 300;
const org: AccessOrganization = { id: 'org-a', name: '사업자 A', status: 'active', features: {} };

function property(id: string, organization: AccessOrganization | null = org, featureOverrides: unknown = {}): AccessProperty {
  return { id, organizationId: organization?.id ?? null, organization, featureOverrides };
}

function user(overrides: Partial<AccessUser> = {}): AccessUser {
  return {
    id: 'user-a', email: 'current@example.test', displayName: '직원', role: 'manager', status: 'active',
    organizationId: org.id, organization: org, enabledModules: null, accessVersion: 1,
    properties: [{ propertyId: 'property-a', property: property('property-a') }],
    ...overrides,
  };
}

function repository(currentUser: AccessUser | null, properties: AccessProperty[] = []): IdentityRepository {
  return {
    async findUser() { return currentUser; },
    async findOrganizationProperties() { return properties; },
  };
}

async function token(payload: Record<string, unknown> = {}, algorithm = 'HS256', signingSecret = secret) {
  return new SignJWT({ userId: 'user-a', email: 'old@example.test', exp: expiresAt, ...payload })
    .setProtectedHeader({ alg: algorithm })
    .sign(new TextEncoder().encode(signingSecret));
}

async function authenticate(currentUser: AccessUser | null, properties: AccessProperty[] = []) {
  const repo = repository(currentUser, properties);
  const identity = await authenticateLegacySession(new Headers({ cookie: `va_session=${await token()}` }), { secret, repository: repo, now });
  return { identity, repo };
}

test('legacy JWT verifies HS256 with the existing secret and preserves its original expiry', async () => {
  assert.deepEqual(await verifyLegacySessionToken(await token(), secret, now), {
    userId: 'user-a', email: 'old@example.test', expiresAt,
  });
  assert.equal(await verifyLegacySessionToken(await token(), `${secret}-wrong`, now), null);
  assert.equal(await verifyLegacySessionToken(await token({}, 'HS384'), secret, now), null);
});

test('expired, future, malformed and missing-expiry credentials are rejected', async () => {
  for (const payload of [
    { exp: now.getTime() / 1000 },
    { exp: now.getTime() / 1000 - 1 },
    { nbf: expiresAt },
    { exp: undefined },
    { userId: '' },
    { userId: 123 },
    { email: undefined },
    { email: ' ' },
  ]) assert.equal(await verifyLegacySessionToken(await token(payload), secret, now), null);
  assert.equal(await verifyLegacySessionToken('not.a.jwt', secret, now), null);
  await assert.rejects(verifyLegacySessionToken(await token(), '', now), /JWT_SECRET/);
});

test('cookie names match exactly and bearer migration must be explicitly enabled', () => {
  assert.equal(readLegacySessionToken(new Headers({ cookie: 'other_va_session=wrong; va_session=correct' })), 'correct');
  assert.equal(readLegacySessionToken(new Headers({ cookie: 'other_va_session=wrong' })), null);
  assert.equal(readLegacySessionToken(new Headers({ authorization: 'Bearer legacy-token' })), null);
  assert.equal(readLegacySessionToken(new Headers({ authorization: 'Bearer legacy-token' }), { allowBearer: true }), 'legacy-token');
});

test('duplicate or empty va_session cookies cannot fall back to another bearer identity', () => {
  for (const cookie of ['va_session=a; va_session=b', 'va_session=']) {
    assert.equal(readLegacySessionToken(new Headers({ cookie, authorization: 'Bearer fallback' }), { allowBearer: true }), null);
  }
});

test('latest database identity overrides stale JWT email and role claims', async () => {
  const repo = repository(user({ role: 'cleaner', enabledModules: ['cleaning'] }));
  const identity = await authenticateLegacySession(new Headers({ cookie: `va_session=${await token({ role: 'super_admin' })}` }), { secret, repository: repo, now });
  assert.equal(identity?.role, 'cleaner');
  assert.equal(identity?.session.email, 'current@example.test');
  assert.equal(identity?.session.expiresAt, expiresAt);
  assert.equal(identity?.isAdmin, false);
});

test('removed, suspended and pending users cannot reuse an otherwise valid session', async () => {
  for (const current of [null, user({ status: 'suspended' }), user({ status: 'pending_invite' }), user({ id: 'another-user' })]) {
    assert.equal((await authenticate(current)).identity, null);
  }
});

test('invalid sessions never query the repository and database errors are not hidden as sign-outs', async () => {
  let calls = 0;
  const repo: IdentityRepository = {
    async findUser() { calls++; throw new Error('fixture database unavailable'); },
    async findOrganizationProperties() { throw new Error('unexpected query'); },
  };
  assert.equal(await authenticateLegacySession(new Headers({ cookie: 'va_session=invalid' }), { secret, repository: repo, now }), null);
  assert.equal(calls, 0);
  await assert.rejects(authenticateLegacySession(new Headers({ cookie: `va_session=${await token()}` }), { secret, repository: repo, now }), /fixture database unavailable/);
  assert.equal(calls, 1);
});

test('database role changes and account suspension take effect on the next request', async () => {
  let current = user({ role: 'super_admin' });
  const repo: IdentityRepository = { async findUser() { return current; }, async findOrganizationProperties() { return []; } };
  const headers = new Headers({ cookie: `va_session=${await token()}` });
  assert.equal((await authenticateLegacySession(headers, { secret, repository: repo, now }))?.isAdmin, true);
  current = user({ role: 'manager', enabledModules: [] });
  const demoted = await authenticateLegacySession(headers, { secret, repository: repo, now });
  assert.equal(demoted?.isAdmin, false);
  await assert.rejects(resolveOperationalScope(demoted!, repo, 'reservations'), error => error instanceof HttpError && error.status === 403);
  current = user({ status: 'suspended' });
  assert.equal(await authenticateLegacySession(headers, { secret, repository: repo, now }), null);
});

test('transaction identity refresh keeps original expiry and rejects revoked or expired sessions', async () => {
  const initial = (await authenticate(user({ role: 'super_admin' }))).identity!;
  const refreshed = await refreshBackendIdentity(initial, repository(user({ role: 'cleaner' })), now);
  assert.equal(refreshed?.role, 'cleaner');
  assert.equal(refreshed?.isAdmin, false);
  assert.equal(refreshed?.session.expiresAt, initial.session.expiresAt);
  assert.equal(await refreshBackendIdentity(initial, repository(user({ status: 'suspended' })), now), null);
  assert.equal(await refreshBackendIdentity(initial, repository(user()), new Date(expiresAt * 1000)), null);
});

test('legacy host/viewer roles retain manager scope without becoming platform administrators', async () => {
  for (const role of ['host', 'viewer', 'unknown']) {
    const { identity, repo } = await authenticate(user({ role }));
    assert.equal(identity?.role, 'manager');
    assert.deepEqual((await resolveOperationalScope(identity!, repo, 'reservations')).propertyIds, ['property-a']);
  }
});

test('manager null grants retain defaults while explicit empty grants reject optional operations', async () => {
  const defaults = await authenticate(user({ enabledModules: null }));
  assert.deepEqual((await resolveOperationalScope(defaults.identity!, defaults.repo, 'reservations')).propertyIds, ['property-a']);
  const empty = await authenticate(user({ enabledModules: [] }));
  await assert.rejects(resolveOperationalScope(empty.identity!, empty.repo, 'reservations'), error => error instanceof HttpError && error.status === 403);
  assert.deepEqual((await resolveOperationalScope(empty.identity!, empty.repo, null)).propertyIds, ['property-a']);
});

test('cleaners cannot obtain reservation or message scope through custom module grants', async () => {
  const { identity, repo } = await authenticate(user({ role: 'cleaner', enabledModules: ['cleaning', 'reservations', 'messages'] }));
  assert.deepEqual((await resolveOperationalScope(identity!, repo, 'cleaning')).propertyIds, ['property-a']);
  for (const moduleKey of ['reservations', 'messages'] as const) {
    await assert.rejects(resolveOperationalScope(identity!, repo, moduleKey), error => error instanceof HttpError && error.status === 403);
  }
});

test('cross-business assignments and disabled property options are excluded from manager scope', async () => {
  const otherOrg = { ...org, id: 'org-b' };
  const assignments = [property('property-a'), property('wrong-business', otherOrg), property('disabled', org, { reservations: false })];
  const { identity, repo } = await authenticate(user({ properties: assignments.map(item => ({ propertyId: item.id, property: item })) }));
  assert.deepEqual((await resolveOperationalScope(identity!, repo, 'reservations')).propertyIds, ['property-a']);
});

test('business administrators receive only their current organization properties', async () => {
  const { identity, repo } = await authenticate(user({ role: 'admin', enabledModules: [] }), [
    property('property-a'), property('another-assignment'), property('disabled', org, { reservations: false }),
    property('wrong-business', { ...org, id: 'org-b' }),
  ]);
  const scope = await resolveOperationalScope(identity!, repo, 'reservations');
  assert.equal(scope.isAdmin, false);
  assert.equal(scope.isBusinessAdmin, true);
  assert.deepEqual(scope.propertyIds, ['property-a', 'another-assignment']);
});

test('unassigned business administrators have no properties and never broaden to global access', async () => {
  const { identity, repo } = await authenticate(user({ role: 'admin', organizationId: null, organization: null }), [property('property-a')]);
  assert.deepEqual((await resolveOperationalScope(identity!, repo, null)).propertyIds, []);
});

test('organization suspension also blocks bootstrap-style module-free reads', async () => {
  const { identity, repo } = await authenticate(user({ organization: { ...org, status: 'suspended' } }));
  await assert.rejects(resolveOperationalScope(identity!, repo, null), error => error instanceof HttpError && error.status === 403);
});

test('business-disabled features cannot be restored by an administrator or property override', async () => {
  const disabledOrg = { ...org, features: { laundry: false } };
  const { identity, repo } = await authenticate(user({ role: 'admin', organization: disabledOrg }), [property('property-a', disabledOrg, { laundry: true })]);
  await assert.rejects(resolveOperationalScope(identity!, repo, 'laundry'), error => error instanceof HttpError && error.status === 403);
});

test('additional provider requirements filter properties and respect organization options', async () => {
  const { identity, repo } = await authenticate(user({ properties: [
    { propertyId: 'property-a', property: property('property-a') },
    { propertyId: 'disabled-provider', property: property('disabled-provider', org, { integrations: false }) },
  ] }));
  assert.deepEqual((await resolveOperationalScope(identity!, repo, 'reservations', ['integrations'])).propertyIds, ['property-a']);
});

test('only super managers retain an explicit null scope and bypass business options', async () => {
  const { identity, repo } = await authenticate(user({ role: 'super_admin', enabledModules: [], organization: { ...org, status: 'suspended', features: { reservations: false } } }));
  assert.equal((await resolveOperationalScope(identity!, repo, 'reservations')).propertyIds, null);
  const manager = await authenticate(user({ properties: [] }));
  assert.deepEqual((await resolveOperationalScope(manager.identity!, manager.repo, 'reservations')).propertyIds, []);
});

test('identity repository selects policy data without password, public tokens or guest data', async () => {
  let userQuery: unknown;
  let propertyQuery: unknown;
  const db = {
    user: { async findUnique(query: unknown) { userQuery = query; return user(); } },
    property: { async findMany(query: unknown) { propertyQuery = query; return [property('property-a')]; } },
  } as unknown as Parameters<typeof createIdentityRepository>[0];
  const repo = createIdentityRepository(db);
  assert.equal((await repo.findUser('user-a'))?.email, 'current@example.test');
  assert.deepEqual((userQuery as { where: unknown }).where, { id: 'user-a' });
  for (const field of ['password', 'publicToken', 'cleanings', 'bookings']) assert.equal(JSON.stringify(userQuery).includes(field), false);
  await repo.findOrganizationProperties('org-a');
  assert.deepEqual((propertyQuery as { where: unknown }).where, { organizationId: 'org-a' });
});

test('missing access schema becomes a recoverable 503 instead of silently granting defaults', async () => {
  const db = {
    user: { async findUnique() { throw { code: 'P2022' }; } },
    property: { async findMany() { return []; } },
  } as unknown as Parameters<typeof createIdentityRepository>[0];
  await assert.rejects(createIdentityRepository(db).findUser('user-a'), error => error instanceof HttpError && error.status === 503 && error.extra?.migrationRequired === true);
});

test('oversized assignment sets fail instead of silently dropping authorized properties', async () => {
  const oversized = user({ properties: Array.from({ length: 2001 }, (_, index) => ({ propertyId: `p${index}`, property: property(`p${index}`) })) });
  const db = {
    user: { async findUnique() { return oversized; } },
    property: { async findMany() { return oversized.properties.map(item => item.property); } },
  } as unknown as Parameters<typeof createIdentityRepository>[0];
  const repo = createIdentityRepository(db);
  await assert.rejects(repo.findUser('user-a'), error => error instanceof HttpError && error.status === 503 && error.extra?.accessScopeTooLarge === true);
  await assert.rejects(repo.findOrganizationProperties('org-a'), error => error instanceof HttpError && error.status === 503 && error.extra?.accessScopeTooLarge === true);
});

test('access revisions change for assignment, grants, organization options and policy version updates', async () => {
  const { identity } = await authenticate(user());
  const totals = { propertyCount: 1, propertyVersions: 1 };
  const initial = accessRevisionFor(identity!, totals);
  for (const changed of [
    { ...identity!, user: { ...identity!.user, enabledModules: [] } },
    { ...identity!, user: { ...identity!.user, accessVersion: 2 } },
    { ...identity!, user: { ...identity!.user, properties: [] } },
    { ...identity!, user: { ...identity!.user, organization: { ...org, features: { reservations: false } } } },
  ]) assert.notEqual(accessRevisionFor(changed, totals), initial);
  assert.notEqual(accessRevisionFor(identity!, { ...totals, propertyVersions: 2 }), initial);
  assert.notEqual(accessRevisionFor(identity!, { ...totals, propertyCount: 2 }), initial);
});

test('access revision is stable across assignment order and object-key order', async () => {
  const assignmentA = { propertyId: 'a', property: property('a', org, { cleaning: true, laundry: false }) };
  const assignmentB = { propertyId: 'b', property: property('b') };
  const { identity } = await authenticate(user({ properties: [assignmentA, assignmentB] }));
  const changed = { ...identity!, user: { ...identity!.user, properties: [assignmentB, { ...assignmentA, property: { ...assignmentA.property, featureOverrides: { laundry: false, cleaning: true } } }] } };
  assert.equal(accessRevisionFor(identity!, { propertyCount: 2, propertyVersions: 2 }), accessRevisionFor(changed, { propertyCount: 2, propertyVersions: 2 }));
});

test('PostgreSQL revision digest detects balanced membership changes and honors tenant scope', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE organizations (id text PRIMARY KEY, name text, status text, version integer, features jsonb);
      CREATE TABLE properties (id text PRIMARY KEY, organization_id text, feature_version integer, feature_overrides jsonb);
      CREATE TABLE user_properties (user_id text, property_id text);
      INSERT INTO organizations VALUES ('org-a', 'A', 'active', 1, '{}'), ('org-b', 'B', 'active', 1, '{}'), ('org-empty', 'Empty', 'active', 1, '{}');
      INSERT INTO properties VALUES ('property-a', 'org-a', 1, '{}'), ('property-b', 'org-b', 1, '{}');
      INSERT INTO user_properties VALUES ('user-a', 'property-a');
    `);
    const db = {
      async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        const query = strings.map((part, index) => part + (index < values.length ? `$${index + 1}` : '')).join('');
        const result = await pg.query(query, values);
        assert.equal(result.rows.length, 1);
        assert.deepEqual(Object.keys(result.rows[0] as object).sort(), ['organizationDigest', 'propertyDigest']);
        return result.rows;
      },
    } as unknown as Parameters<typeof createAccessRevisionReader>[0];
    const getRevision = createAccessRevisionReader(db);
    const manager = (await authenticate(user())).identity!;
    const admin = (await authenticate(user({ role: 'admin' }))).identity!;
    const superAdmin = (await authenticate(user({ role: 'super_admin' }))).identity!;
    const initial = await getRevision(manager);
    assert.match(initial, /^[A-Za-z0-9_-]{43}$/);
    await pg.exec(`UPDATE properties SET feature_version = 2, feature_overrides = '{"laundry":false}' WHERE id = 'property-b'`);
    assert.equal(await getRevision(manager), initial);
    const adminBeforeSwap = await getRevision(admin);
    await pg.exec(`UPDATE properties SET id = 'property-replacement' WHERE id = 'property-a'`);
    assert.notEqual(await getRevision(admin), adminBeforeSwap);
    assert.notEqual(await getRevision(manager), initial);
    const superBefore = await getRevision(superAdmin);
    await pg.exec(`UPDATE organizations SET status = 'suspended' WHERE id = 'org-empty'`);
    assert.notEqual(await getRevision(superAdmin), superBefore);
  } finally {
    await pg.close();
  }
});
