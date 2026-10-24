import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { SignJWT } from 'jose';
import { fail } from '../lib/core/errors';
import { authenticateLegacySession, type AccessUser } from '../packages/domain/identity/access';
import type { OperationsService } from '../packages/domain/operations/service';
import { createBackendApplication, type BackendDependencies } from '../services/api/application';
import { backendConfig } from '../services/api/config';

const config = backendConfig({
  NODE_ENV: 'test',
  BACKEND_BRIDGE_SECRET: 'fixture-bridge-secret-with-at-least-thirty-two-characters',
  JWT_SECRET: 'fixture-legacy-session-secret',
  BACKEND_WEB_ORIGIN: 'http://localhost:3117',
});

function account(overrides: Partial<AccessUser> = {}): AccessUser {
  return {
    id: 'staff-fixture', email: 'staff@example.test', displayName: '직원', role: 'manager', status: 'active',
    enabledModules: null, accessVersion: 1, organizationId: 'org-fixture',
    organization: { id: 'org-fixture', name: '운영 테스트', status: 'active', features: {}, version: 1 },
    properties: [], ...overrides,
  };
}

let currentUser: AccessUser | null;
let app: Awaited<ReturnType<typeof createBackendApplication>>;
let baseUrl: string;
let sessionCookie: string;
let authenticateCalls = 0;
let readyCalls = 0;
let readyError: unknown;
let readError: unknown;
const readCalls: string[] = [];
const commandCalls: Parameters<BackendDependencies['command']>[0][] = [];
const workflowCalls: Parameters<NonNullable<BackendDependencies['workflow']>>[0][] = [];
const serviceCalls: Array<{ operation: string; userId: string; body?: unknown }> = [];
const logs: Parameters<NonNullable<BackendDependencies['log']>>[0][] = [];

const operations = {
  async createOrganization(actor: { session: { userId: string } }, body: unknown) {
    serviceCalls.push({ operation: 'createOrganization', userId: actor.session.userId, body });
    return { id: 'organization-created' };
  },
  async getOperationsSettings(actor: { session: { userId: string } }) {
    serviceCalls.push({ operation: 'settings', userId: actor.session.userId });
    return { organizations: [], users: [], properties: [] };
  },
} as unknown as OperationsService;

before(async () => {
  const token = await new SignJWT({ userId: 'staff-fixture', email: 'old@example.test' })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(config.jwtSecret));
  sessionCookie = `va_session=${token}`;
  app = await createBackendApplication({
    authenticate(headers) {
      authenticateCalls++;
      return authenticateLegacySession(headers, { secret: config.jwtSecret, repository: {
        async findUser() { return currentUser; }, async findOrganizationProperties() { return []; },
      } });
    },
    async accessRevision() { return 'fixture-access-revision'; },
    async read(route) { readCalls.push(route); if (readError) throw readError; return { route }; },
    operations,
    async workflow(input) { workflowCalls.push(input); return { accepted: true }; },
    async command(input, execute) { commandCalls.push(input); return execute(operations, input.identity); },
    async ready() { readyCalls++; if (readyError) throw readyError; },
    log(entry) { logs.push(entry); },
  }, config);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

beforeEach(() => {
  currentUser = account();
  authenticateCalls = 0;
  readyCalls = 0;
  readyError = undefined;
  readError = undefined;
  readCalls.length = 0;
  commandCalls.length = 0;
  workflowCalls.length = 0;
  serviceCalls.length = 0;
  logs.length = 0;
});

after(async () => { await app?.close(); });

function staffHeaders(extra: Record<string, string> = {}) {
  return { 'x-backend-key': config.bridgeSecret, cookie: sessionCookie, ...extra };
}

function mutationHeaders(extra: Record<string, string> = {}) {
  return staffHeaders({ origin: config.webOrigin, 'content-type': 'application/json', 'idempotency-key': 'fixture-command-001', ...extra });
}

test('liveness is public, readiness and contract require only the private bridge key', async () => {
  assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 401);
  assert.equal(readyCalls, 0);
  assert.equal((await fetch(`${baseUrl}/health/ready`, { headers: { 'x-backend-key': config.bridgeSecret } })).status, 200);
  assert.equal(readyCalls, 1);
  assert.equal(authenticateCalls, 0);
  assert.equal((await fetch(`${baseUrl}/openapi.json`)).status, 401);
  const schema = await fetch(`${baseUrl}/openapi.json`, { headers: { 'x-backend-key': config.bridgeSecret } });
  assert.equal(schema.status, 200);
  assert.equal((await schema.json()).openapi, '3.1.0');
});

test('missing or incorrect bridge keys stop requests before staff authentication', async () => {
  const attempts: Record<string, string>[] = [{ cookie: sessionCookie }, { cookie: sessionCookie, 'x-backend-key': 'incorrect' }];
  for (const headers of attempts) {
    const response = await fetch(`${baseUrl}/api/app/v1/bootstrap`, { headers });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
  }
  assert.equal(authenticateCalls, 0);
  assert.equal(readCalls.length, 0);
});

test('staff cookie is required and Authorization alone does not bypass the migration boundary', async () => {
  const attempts: Record<string, string>[] = [
    { 'x-backend-key': config.bridgeSecret },
    { 'x-backend-key': config.bridgeSecret, authorization: `Bearer ${sessionCookie.slice('va_session='.length)}` },
    { 'x-backend-key': config.bridgeSecret, cookie: `other_${sessionCookie}` },
    { 'x-backend-key': config.bridgeSecret, cookie: 'va_session=invalid' },
  ];
  for (const headers of attempts) assert.equal((await fetch(`${baseUrl}/api/app/v1/bootstrap`, { headers })).status, 401);
  const response = await fetch(`${baseUrl}/api/app/v1/bootstrap`, { headers: staffHeaders() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-access-revision'), 'fixture-access-revision');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-powered-by'), null);
  const body = await response.json();
  assert.equal(body.data.route, 'bootstrap');
  assert.equal(body.meta.requestId, response.headers.get('x-request-id'));
});

test('suspended accounts and organizations cannot read business data', async () => {
  currentUser = account({ status: 'suspended' });
  assert.equal((await fetch(`${baseUrl}/api/app/v1/bootstrap`, { headers: staffHeaders() })).status, 401);
  currentUser = account({ organization: { ...account().organization!, status: 'inactive' } });
  const response = await fetch(`${baseUrl}/api/app/v1/bootstrap`, { headers: staffHeaders() });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-access-revision'), 'fixture-access-revision');
  assert.equal(readCalls.length, 0);
});

test('module checks separate cleaner schedules from reservation calendars', async () => {
  currentUser = account({ role: 'cleaner', enabledModules: ['cleaning', 'reservations'] });
  assert.equal((await fetch(`${baseUrl}/api/app/v1/calendar?month=2026-10`, { headers: staffHeaders() })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/app/v1/cleaner/calendar?month=2026-10`, { headers: staffHeaders() })).status, 200);
  assert.deepEqual(readCalls, ['cleanerCalendar']);
  currentUser = account({ enabledModules: [] });
  assert.equal((await fetch(`${baseUrl}/api/app/v1/calendar?month=2026-10`, { headers: staffHeaders() })).status, 403);
  currentUser = account({ role: 'admin', organization: { ...account().organization!, features: { reservations: false } } });
  assert.equal((await fetch(`${baseUrl}/api/app/v1/calendar?month=2026-10`, { headers: staffHeaders() })).status, 403);
});

test('management reads require administrators and business accounts cannot create organizations', async () => {
  assert.equal((await fetch(`${baseUrl}/api/app/v1/settings`, { headers: staffHeaders() })).status, 403);
  currentUser = account({ role: 'admin' });
  assert.equal((await fetch(`${baseUrl}/api/app/v1/settings`, { headers: staffHeaders() })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ name: 'fixture' }) })).status, 403);
  assert.equal(commandCalls.length, 0);
});

test('mutations reject missing or foreign origins before command execution', async () => {
  currentUser = account({ role: 'super_admin' });
  for (const origin of ['', 'https://attacker.example', 'http://localhost:3117.attacker.example', 'null']) {
    const headers = mutationHeaders({ origin });
    if (!origin) delete (headers as Record<string, string>).origin;
    assert.equal((await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers, body: '{}' })).status, 403);
  }
  assert.equal(commandCalls.length, 0);
});

test('mutations require a well-formed idempotency key and JSON object', async () => {
  currentUser = account({ role: 'super_admin' });
  for (const key of ['', 'tiny', 'invalid/key', 'x'.repeat(201)]) {
    const response = await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders({ 'idempotency-key': key }), body: '{}' });
    assert.equal(response.status, 400);
  }
  for (const body of ['[]', '"text"', 'null']) {
    assert.equal((await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders(), body })).status, 400);
  }
  assert.equal((await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders({ 'content-type': 'text/plain' }), body: '{}' })).status, 400);
  assert.equal(commandCalls.length, 0);
});

test('authorized commands execute once with verified identity, original target and revision', async () => {
  currentUser = account({ role: 'super_admin' });
  const body = { name: '새 사업자', features: { laundry: true } };
  const response = await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(body) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.organization.id, 'organization-created');
  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0].identity.role, 'super_admin');
  assert.equal(commandCalls[0].identity.session.email, 'staff@example.test');
  assert.equal(commandCalls[0].revision, 'fixture-access-revision');
  assert.equal(commandCalls[0].key, 'fixture-command-001');
  assert.equal(commandCalls[0].targetId, '');
  assert.deepEqual(serviceCalls, [{ operation: 'createOrganization', userId: 'staff-fixture', body }]);
});

test('unexpected failures and request logs do not expose credentials, query values or bodies', async () => {
  const sensitive = 'credential-and-guest-text-not-for-logs';
  readError = new Error(`postgres://admin:${sensitive}@database/private`);
  const response = await fetch(`${baseUrl}/api/app/v1/bootstrap?password=${sensitive}`, { headers: staffHeaders({ 'x-untrusted-secret': sensitive }) });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(JSON.stringify(body).includes(sensitive), false);
  assert.equal(JSON.stringify(body).includes('postgres'), false);
  currentUser = account({ role: 'super_admin' });
  await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ name: sensitive, password: sensitive }) });
  assert.ok(logs.length >= 2);
  assert.equal(JSON.stringify(logs).includes(sensitive), false);
  assert.equal(JSON.stringify(logs).includes(config.bridgeSecret), false);
  assert.equal(JSON.stringify(logs).includes(sessionCookie), false);
  for (const entry of logs) assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'method', 'requestId', 'route', 'status']);
});

test('domain errors expose only approved recovery fields and readiness failures are redacted', async () => {
  readError = fail(409, '새로고침 후 다시 저장해 주세요.', { code: 'VERSION_CONFLICT', currentVersion: 7, password: 'secret', token: 'private' });
  const response = await fetch(`${baseUrl}/api/app/v1/bootstrap`, { headers: staffHeaders() });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(body.error.details, { currentVersion: 7 });
  assert.equal(body.error.retryable, false);
  readyError = new Error('database password should stay private');
  const readiness = await fetch(`${baseUrl}/health/ready`, { headers: { 'x-backend-key': config.bridgeSecret } });
  assert.equal(readiness.status, 503);
  assert.equal((await readiness.text()).includes('password'), false);
});

test('unknown private endpoints return a safe 404', async () => {
  const response = await fetch(`${baseUrl}/api/app/v1/no-such-endpoint`, { headers: staffHeaders() });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

test('malformed JSON and payloads above the configured limit are client errors', async () => {
  currentUser = account({ role: 'super_admin' });
  const malformed = await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders(), body: '{malformed' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).meta.requestId, malformed.headers.get('x-request-id'));
  const oversized = await fetch(`${baseUrl}/api/app/v1/organizations`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ name: 'a'.repeat(66_000) }) });
  assert.equal(oversized.status, 413);
  const body = await oversized.json();
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(body.meta.requestId, oversized.headers.get('x-request-id'));
  assert.ok(logs.some(entry => entry.requestId === body.meta.requestId && entry.status === 413));
  assert.equal(commandCalls.length, 0);
});

test('new operational routes enforce module grants and cleaner restrictions before dispatch', async () => {
  currentUser = account({ role: 'cleaner', enabledModules: ['inventory', 'laundry', 'supplies'] });
  for (const path of ['reservations', 'guests', 'settlement', 'settlement/export', 'jongno-events']) {
    const response = await fetch(`${baseUrl}/api/app/v1/${path}`, { headers: staffHeaders() });
    assert.equal(response.status, 403, path);
  }
  currentUser = account({ role: 'manager', enabledModules: ['inventory'] });
  const denied = await fetch(`${baseUrl}/api/app/v1/laundry`, { headers: staffHeaders() });
  assert.equal(denied.status, 403);
  assert.equal(workflowCalls.length, 0);
  const permitted = await fetch(`${baseUrl}/api/app/v1/inventory?propertyId=assigned`, { headers: staffHeaders() });
  assert.equal(permitted.status, 200);
  assert.equal(workflowCalls[0].route.id, 'readInventory');
  assert.equal(workflowCalls[0].query.get('propertyId'), 'assigned');
  const missingKey = await fetch(`${baseUrl}/api/app/v1/inventory/counts`, { method: 'POST', headers: staffHeaders({ origin: config.webOrigin, 'content-type': 'application/json' }), body: '{}' });
  assert.equal(missingKey.status, 400);
  assert.equal(workflowCalls.length, 1);
});

test('event photos have a dedicated body limit and other commands retain the small limit', async () => {
  currentUser = account({ role: 'super_admin' });
  const largeBody = JSON.stringify({ mimeType: 'image/png', data: 'a'.repeat(80_000) });
  const photo = await fetch(`${baseUrl}/api/app/v1/jongno-events/images`, { method: 'POST', headers: mutationHeaders(), body: largeBody });
  assert.equal(photo.status, 201);
  assert.equal(workflowCalls.length, 1);
  const normal = await fetch(`${baseUrl}/api/app/v1/reservations`, { method: 'POST', headers: mutationHeaders(), body: largeBody });
  assert.equal(normal.status, 413);
  const tooLarge = await fetch(`${baseUrl}/api/app/v1/jongno-events/images`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ data: 'a'.repeat(3 * 1024 * 1024) }) });
  assert.equal(tooLarge.status, 413);
  assert.equal(workflowCalls.length, 1);
});

test('reservation references survive URL decoding and invalid command bodies never dispatch', async () => {
  currentUser = account({ role: 'admin' });
  const response = await fetch(`${baseUrl}/api/app/v1/reservations/event%3Afixture`, { headers: staffHeaders() });
  assert.equal(response.status, 200);
  assert.equal(workflowCalls[0].targetId, 'event:fixture');
  const invalid = await fetch(`${baseUrl}/api/app/v1/reservations`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ propertyId: 'fixture', adults: 0 }) });
  assert.equal(invalid.status, 400);
  assert.equal(workflowCalls.length, 1);
});
