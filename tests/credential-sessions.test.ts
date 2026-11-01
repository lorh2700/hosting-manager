import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import { db, prisma, resetDb, prismaOverrides } from './stubs/prisma';
import { authState, issuedSessionClaims } from './stubs/auth';
import { requestCookies } from './stubs/next-headers';
import { POST as changePassword } from '../app/api/auth/change-password/route';

(globalThis as unknown as { prisma: unknown }).prisma = prisma;
const { signToken, verifyToken, verifySession, getSessionWithUser, getSession } = await import('../lib/auth');
const key = new TextEncoder().encode(process.env.JWT_SECRET!);
const claims = { userId: 'account', email: 'account@example.invalid' };
const context = { params: Promise.resolve({}) };
const sessionRequest = (token: string) => new Request('https://example.invalid/api/auth/me', { headers: { cookie: `va_session=${token}` } });
const passwordRequest = (currentPassword: string, newPassword: string) => new Request('https://example.invalid/api/auth/change-password', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }),
});
const legacyToken = () => new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key);

beforeEach(() => {
  resetDb(); requestCookies.clear(); issuedSessionClaims.length = 0;
  db.user = [{ id: claims.userId, email: claims.email, credentialVersion: 0, status: 'active', role: 'manager', organizationId: null, enabledModules: null }];
  db.userProperty = []; db.organization = []; db.property = [];
  authState.auth = { session: { ...claims, credentialVersion: 0 }, user: { ...db.user[0] }, role: 'manager', propertyIds: [] };
});

test('legacy missing-version sessions work only until credentials rotate, including profile reads', async () => {
  const token = await legacyToken();
  requestCookies.set('va_session', token);
  assert.equal((await verifyToken(token))?.credentialVersion, 0);
  assert.equal((await verifySession(sessionRequest(token)))?.userId, claims.userId);
  assert.equal((await getSessionWithUser(sessionRequest(token)))?.user.id, claims.userId);
  assert.equal((await getSession())?.user.id, claims.userId);
  db.user[0].credentialVersion = 1;
  assert.equal(await verifySession(sessionRequest(token)), null);
  assert.equal(await getSessionWithUser(sessionRequest(token), { allowInactive: true }), null);
  assert.equal(await getSession(), null);
  const next = await signToken({ ...claims, credentialVersion: 1 });
  requestCookies.set('va_session', next);
  assert.equal((await getSession())?.user.id, claims.userId);
  assert.equal((await verifySession(sessionRequest(next)))?.credentialVersion, 1);
});

test('session verification rejects malformed claims, alternate algorithms and expired tokens', async () => {
  for (const value of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    const token = await new SignJWT({ ...claims, credentialVersion: value }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key);
    assert.equal(await verifyToken(token), null);
  }
  for (const payload of [{ email: claims.email }, { userId: claims.userId }, { ...claims, userId: '' }, { ...claims, email: '' }]) {
    assert.equal(await verifyToken(await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)), null);
  }
  assert.equal(await verifyToken(await new SignJWT(claims).setProtectedHeader({ alg: 'HS384' }).setExpirationTime('1h').sign(key)), null);
  assert.equal(await verifyToken(await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(key)), null);
  assert.equal(await verifyToken(await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(1).sign(key)), null);
});

test('authenticated password change replaces the hash and rotates the current browser session once', async () => {
  db.user[0].password = await bcrypt.hash('previous-password', 4);
  authState.auth.user = { ...db.user[0] };
  const response = await changePassword(passwordRequest('previous-password', 'replacement-password'), context);
  assert.equal(response.status, 200);
  assert.equal(db.user[0].credentialVersion, 1);
  assert.equal(await bcrypt.compare('replacement-password', db.user[0].password), true);
  assert.equal(await bcrypt.compare('previous-password', db.user[0].password), false);
  assert.deepEqual(issuedSessionClaims, [{ ...claims, credentialVersion: 1 }]);
});

test('password change preserves newer credentials when another change wins during hashing', async () => {
  db.user[0].password = await bcrypt.hash('previous-password', 4);
  authState.auth.user = { ...db.user[0] };
  const newerHash = await bcrypt.hash('already-reset-password', 4);
  const original = prisma.user.updateMany;
  prismaOverrides.user = { updateMany: async (args: unknown) => {
    db.user[0].password = newerHash; db.user[0].credentialVersion = 1;
    delete prismaOverrides.user;
    return original(args);
  } };
  const response = await changePassword(passwordRequest('previous-password', 'replacement-password'), context);
  assert.equal(response.status, 409);
  assert.equal(db.user[0].password, newerHash);
  assert.equal(db.user[0].credentialVersion, 1);
  assert.equal(issuedSessionClaims.length, 0);
});

test('new passwords reject short values and UTF-8 truncation without changing stored credentials', async () => {
  db.user[0].password = await bcrypt.hash('previous-password', 4);
  authState.auth.user = { ...db.user[0] };
  for (const value of ['short', '가'.repeat(25)]) {
    assert.equal((await changePassword(passwordRequest('previous-password', value), context)).status, 400);
  }
  assert.equal((await changePassword(passwordRequest('incorrect-password', 'replacement-password'), context)).status, 400);
  assert.equal(db.user[0].credentialVersion, 0);
  assert.equal(issuedSessionClaims.length, 0);
});
