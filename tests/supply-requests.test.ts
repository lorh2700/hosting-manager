import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GET, POST, PUT } from '../app/api/supply-requests/route';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsAnonymous, actAsCleaner, actAsManager, authState } from './stubs/auth';
import { callRoute, makeRequest } from './helpers/beds24-mock';

const id = '18aa9e72-4728-4a64-bb38-d77d4a74dd02';
const input = { id, propertyId: 'p1', items: [{ name: '휴지', quantity: 2, unit: '개', note: null }], urgency: 'normal' };
beforeEach(() => {
  resetDb(); actAsCleaner(['p1']); authState.auth.user.displayName = '현정';
  db.property = [{ id: 'p1', name: '안온재' }, { id: 'p2', name: '화연재' }];
});

test('supply request trusts session identity and keeps legacy optional unit and nullable note', async () => {
  const result = await callRoute(POST, makeRequest({ propertyId: 'p1', items: [{ name: ' 휴지 ', quantity: 2, note: null }], requestedBy: 'other', requestedByName: '다른 사람', status: 'completed' }));
  assert.equal(result.status, 201); assert.equal(result.body.requestedBy, 'cleaner-1'); assert.equal(result.body.requestedByName, '현정');
  assert.equal(result.body.status, 'pending'); assert.deepEqual(result.body.items, [{ name: '휴지', quantity: 2, note: null }]);
});

test('supply validation rejects zero, fractions, over-limit, long fields and invalid UUIDs', async () => {
  for (const quantity of [0, -1, 1.5, 10001, '2']) assert.equal((await callRoute(POST, makeRequest({ ...input, items: [{ name: '휴지', quantity }] }))).status, 400);
  for (const patch of [{ id: 'not-a-uuid' }, { items: [] }, { items: Array.from({ length: 31 }, () => input.items[0]) },
    { items: [{ ...input.items[0], name: '' }] }, { items: [{ ...input.items[0], name: 'a'.repeat(61) }] },
    { items: [{ ...input.items[0], unit: '' }] }, { items: [{ ...input.items[0], unit: 'a'.repeat(21) }] }]) {
    assert.equal((await callRoute(POST, makeRequest({ ...input, ...patch }))).status, 400);
  }
  assert.equal((db.supplyRequest || []).length, 0);
});

test('same supply UUID retry returns one row; changed content conflicts', async () => {
  assert.equal((await callRoute(POST, makeRequest(input))).status, 201);
  assert.equal((await callRoute(POST, makeRequest(input))).status, 200);
  for (const patch of [{ items: [{ ...input.items[0], quantity: 3 }] }, { urgency: 'urgent' }, { statusNote: '새 메모' }]) {
    assert.equal((await callRoute(POST, makeRequest({ ...input, ...patch }))).status, 409);
  }
  assert.equal(db.supplyRequest.length, 1);
});

test('concurrent supply creation under one UUID creates once', async () => {
  const results = await Promise.all([callRoute(POST, makeRequest(input)), callRoute(POST, makeRequest(input))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]); assert.equal(db.supplyRequest.length, 1);
});

test('supply original UUID retry survives processing edits and server metadata stays private', async () => {
  const created = await callRoute(POST, makeRequest({ ...input, items: [{ ...input.items[0], _creationRequestFingerprint: 'spoofed' }] }));
  assert.equal(created.status, 201); assert.deepEqual(created.body.items, input.items);
  const fingerprint = db.supplyRequest[0].items[0]._creationRequestFingerprint;
  assert.match(fingerprint, /^[a-f0-9]{64}$/); assert.notEqual(fingerprint, 'spoofed');
  actAsManager(['p1']);
  const processed = await callRoute(PUT, makeRequest({ id, status: 'approved', urgency: 'urgent', statusNote: '발주 진행' }));
  assert.equal(processed.status, 200); assert.deepEqual(processed.body.items, input.items);
  actAsCleaner(['p1']);
  const retried = await callRoute(POST, makeRequest(input));
  assert.equal(retried.status, 200); assert.equal(retried.body.status, 'approved'); assert.equal(retried.body.statusNote, '발주 진행');
  assert.deepEqual(retried.body.items, input.items);
  const listed = await callRoute(GET, makeRequest({})); assert.deepEqual(listed.body[0].items, input.items);
  assert.equal(db.supplyRequest.length, 1); assert.equal(db.supplyRequest[0].items[0]._creationRequestFingerprint, fingerprint);
});

test('supply default query is bounded and optional take remains within 1 to 200', async () => {
  actAsAdmin(); db.supplyRequest = Array.from({ length: 220 }, (_, index) => ({ id: String(index), propertyId: 'p1', items: [], createdAt: index }));
  assert.equal((await callRoute(GET, makeRequest({}))).body.length, 100);
  assert.equal((await callRoute(GET, makeRequest({}, 'http://localhost/api/supply-requests?take=200'))).body.length, 200);
  assert.equal((await callRoute(GET, makeRequest({}, 'http://localhost/api/supply-requests?take=7'))).body.length, 7);
  for (const take of ['0', '201', '1.5', 'nope']) assert.equal((await callRoute(GET, makeRequest({}, 'http://localhost/api/supply-requests?take=' + take))).status, 400);
});

test('supply scope preserves propertyIds filter and enforces write/read permission', async () => {
  actAsAnonymous(); assert.equal((await callRoute(POST, makeRequest(input))).status, 401);
  actAsCleaner(['p1']); assert.equal((await callRoute(POST, makeRequest({ ...input, propertyId: 'p2' }))).status, 403);
  actAsAdmin(); db.supplyRequest = [{ id: 'one', propertyId: 'p1', items: [] }, { id: 'two', propertyId: 'p2', items: [] }];
  assert.deepEqual((await callRoute(GET, makeRequest({}, 'http://localhost/api/supply-requests?propertyIds=p2'))).body.map((row: { id: string }) => row.id), ['two']);
  actAsCleaner(['p1']); assert.deepEqual((await callRoute(GET, makeRequest({}, 'http://localhost/api/supply-requests?propertyIds=p2'))).body, []);
});

test('free-text supply round-trip preserves multiline content without product quantities', async () => {
  const text = '휴지가 부족해요.\n\n생수도 부탁드립니다.\n  창고 앞에 두어 주세요.';
  const created = await callRoute(POST, makeRequest({ id, propertyId: 'p1', text: '  ' + text.replace(/\n/g, '\r\n') + '\r\n', requestedByName: '위조', requestedBy: 'other' }));
  assert.equal(created.status, 201); assert.equal(created.body.requestText, text); assert.deepEqual(created.body.items, []);
  assert.equal(created.body.requestedBy, 'cleaner-1'); assert.equal(created.body.requestedByName, '현정');
  const content = db.supplyRequest[0].items[0];
  assert.equal(content.kind, 'text'); assert.equal(content.text, text);
  assert.ok(!('quantity' in content)); assert.ok(!('unit' in content)); assert.ok(!('name' in content));
  assert.match(content._creationRequestFingerprint, /^[a-f0-9]{64}$/);
  const listed = await callRoute(GET, makeRequest({}));
  assert.equal(listed.body[0].requestText, text); assert.deepEqual(listed.body[0].items, []);
  assert.ok(!JSON.stringify(listed.body).includes('_creationRequestFingerprint'));
  actAsManager(['p1']);
  const processed = await callRoute(PUT, makeRequest({ id, status: 'approved', statusNote: '준비 중' }));
  assert.equal(processed.status, 200); assert.equal(processed.body.requestText, text); assert.deepEqual(processed.body.items, []);
  assert.equal(db.supplyRequest[0].items[0].text, text);
});

test('free-text supply rejects blank, invalid, oversized and ambiguous content', async () => {
  for (const text of ['', ' ', '\r\n \t\r\n', null, 42, 'a'.repeat(2001)]) {
    assert.equal((await callRoute(POST, makeRequest({ id, propertyId: 'p1', text }))).status, 400);
  }
  assert.equal((await callRoute(POST, makeRequest({ ...input, text: '휴지를 부탁드립니다.' }))).status, 400);
  assert.equal((await callRoute(POST, makeRequest({ id, propertyId: 'p1' }))).status, 400);
  assert.equal((db.supplyRequest || []).length, 0);
  const limit = await callRoute(POST, makeRequest({ id, propertyId: 'p1', text: 'a'.repeat(2000) }));
  assert.equal(limit.status, 201); assert.equal(limit.body.requestText.length, 2000);
});

test('free-text UUID retry normalizes whitespace and survives manager processing edits', async () => {
  const original = { id, propertyId: 'p1', text: '휴지 부탁드립니다.\n생수도 부족합니다.', urgency: 'normal', statusNote: '현장 확인' };
  assert.equal((await callRoute(POST, makeRequest(original))).status, 201);
  actAsManager(['p1']);
  assert.equal((await callRoute(PUT, makeRequest({ id, status: 'completed', urgency: 'urgent', statusNote: '발주 완료' }))).status, 200);
  actAsCleaner(['p1']);
  const retry = await callRoute(POST, makeRequest({ ...original, text: '\r\n' + original.text.replace(/\n/g, '\r\n') + '  ' }));
  assert.equal(retry.status, 200); assert.equal(retry.body.status, 'completed'); assert.equal(retry.body.statusNote, '발주 완료');
  assert.equal(retry.body.requestText, original.text); assert.deepEqual(retry.body.items, []);
  for (const patch of [{ text: '다른 요청입니다.' }, { urgency: 'urgent' }, { statusNote: '바뀐 최초 메모' }]) {
    assert.equal((await callRoute(POST, makeRequest({ ...original, ...patch }))).status, 409);
  }
  assert.equal((await callRoute(POST, makeRequest(input))).status, 409);
  assert.equal(db.supplyRequest.length, 1);
});

test('structured UUID cannot be reused for a text request', async () => {
  assert.equal((await callRoute(POST, makeRequest(input))).status, 201);
  assert.equal((await callRoute(POST, makeRequest({ id, propertyId: 'p1', text: '휴지 2개' }))).status, 409);
  const listed = await callRoute(GET, makeRequest({}));
  assert.deepEqual(listed.body[0].items, input.items); assert.ok(!('requestText' in listed.body[0]));
  assert.equal(db.supplyRequest.length, 1);
});

test('concurrent free-text supply retry creates once and enforces actor and property access', async () => {
  const original = { id, propertyId: 'p1', text: '수건 보충이 필요해요.' };
  const results = await Promise.all([callRoute(POST, makeRequest(original)), callRoute(POST, makeRequest(original))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]); assert.equal(db.supplyRequest.length, 1);
  actAsAdmin(); assert.equal((await callRoute(POST, makeRequest(original))).status, 409);
  actAsCleaner(['p2']); assert.equal((await callRoute(POST, makeRequest(original))).status, 403);
  actAsAnonymous(); assert.equal((await callRoute(POST, makeRequest(original))).status, 401);
  assert.equal(db.supplyRequest.length, 1);
});

test('pre-text structured request fingerprint remains retry compatible', async () => {
  const canonicalItems = JSON.stringify(input.items.map(item => ({ name: item.name, quantity: item.quantity, unit: item.unit, note: item.note })));
  const oldFingerprint = createHash('sha256').update(JSON.stringify({ actorId: 'cleaner-1', propertyId: 'p1', items: canonicalItems, urgency: 'normal', statusNote: null })).digest('hex');
  db.supplyRequest = [{ id, propertyId: 'p1', requestedBy: 'cleaner-1', requestedByName: '현정', urgency: 'urgent', status: 'approved', statusNote: '처리 변경',
    items: [{ ...input.items[0], _creationRequestFingerprint: oldFingerprint }] }];
  const retry = await callRoute(POST, makeRequest(input));
  assert.equal(retry.status, 200); assert.deepEqual(retry.body.items, input.items); assert.equal(retry.body.status, 'approved');
  assert.ok(!('requestText' in retry.body));
});
