import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/inventory/route';
import { inventoryCountInput } from '../lib/inventory';
import { db, calls, resetDb, prismaOverrides } from './stubs/prisma';
import { actAsAdmin, actAsAnonymous, actAsCleaner, actAsManager, authState } from './stubs/auth';
import { makeRequest, callRoute } from './helpers/beds24-mock';

const firstId = '18aa9e72-4728-4a64-bb38-d77d4a74dd02';
const secondId = '25aa9e72-4728-4a64-bb38-d77d4a74dd02';
const thirdId = '35aa9e72-4728-4a64-bb38-d77d4a74dd02';
const checkedAt = '2026-10-01T03:00:00.000Z';
const item = (name: string, quantity: number) => ({ name, quantity, checkedAt, checkedBy: '이전 확인자' });
const body = (over: Record<string, unknown> = {}) => ({ id: firstId, propertyId: 'p1', version: 0, items: [{ name: '수건', quantity: 12 }], ...over });
const read = (propertyId?: string) => callRoute(GET, new Request(`https://example.com/api/inventory${propertyId ? `?propertyId=${propertyId}` : ''}`));
const save = (input: Record<string, unknown>) => callRoute(POST, makeRequest(input));

beforeEach(() => {
  resetDb();
  actAsCleaner(['p1']);
  db.property = [{ id: 'p1', name: '운와당', ownerId: 'host-1' }, { id: 'p2', name: '화연재', ownerId: 'host-1' }];
});

test('active accounts only: anonymous, suspended and foreign-property access cannot read or save', async () => {
  actAsAnonymous();
  assert.equal((await read()).status, 401);
  assert.equal((await save(body())).status, 401);
  actAsCleaner(['p1']);
  authState.auth.user.status = 'suspended';
  assert.equal((await read('p1')).status, 401);
  assert.equal((await save(body())).status, 401);
  actAsCleaner(['p2']);
  assert.equal((await read('p1')).status, 403);
  assert.equal((await save(body())).status, 403);
  assert.equal(db.inventorySnapshot?.length ?? 0, 0);
});

test('property picker retains role scope, does not leak stock, and distinguishes a missing property', async () => {
  db.inventorySnapshot = [{ propertyId: 'p1', version: 1, items: [item('수건', 10)] }];
  const picker = await read();
  assert.deepEqual(picker.body, { properties: [{ id: 'p1', name: '운와당' }], version: 0, items: [], available: true });
  actAsManager(['p2']);
  assert.deepEqual((await read()).body.properties, [{ id: 'p2', name: '화연재' }]);
  actAsAdmin();
  assert.equal((await read()).body.properties.length, 2);
  assert.equal((await read('absent')).status, 404);
  assert.equal((await save(body({ propertyId: 'absent' }))).status, 404);
});

test('a partial physical count replaces checked quantities including zero and preserves omitted items and their provenance', async () => {
  db.inventorySnapshot = [{ propertyId: 'p1', version: 4, items: [item('수건', 20), item('베개커버', 8)] }];
  authState.auth.user.displayName = '현정';
  const result = await save(body({ version: 4, items: [{ name: '수건', quantity: 0 }] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.saved, true);
  assert.equal(result.body.id, firstId);
  assert.equal(result.body.version, 5);
  assert.equal(result.body.items.find((row: { name: string }) => row.name === '수건').quantity, 0);
  assert.deepEqual(result.body.items.find((row: { name: string }) => row.name === '베개커버'), item('베개커버', 8));
  const changed = result.body.items.find((row: { name: string }) => row.name === '수건');
  assert.equal(changed.checkedBy, '현정');
  assert.ok(Date.parse(changed.checkedAt) > Date.parse(checkedAt));
  assert.equal(db.inventoryCountRecord[0].checkedById, 'cleaner-1');
  assert.equal(db.inventoryCountRecord[0].items.length, 1);
  assert.deepEqual(db.inventoryCountRecord[0].resultItems, result.body.items);
  assert.deepEqual((await read('p1')).body.items, result.body.items);
  assert.equal(calls.some(call => /laundry|supplyRequest/.test(call)), false);
});

test('strict inputs reject negative/fractional/excess counts, duplicate normalized names, forged authors and excessive requests', async () => {
  for (const items of [[], [{ name: '수건', quantity: -1 }], [{ name: '수건', quantity: 1.5 }], [{ name: '수건', quantity: 10001 }],
    [{ name: '수건', quantity: '3' }], [{ name: '', quantity: 3 }], [{ name: '수건', quantity: 1 }, { name: ' 수건 ', quantity: 2 }],
    [{ name: '수건', quantity: 1, checkedBy: '위조', checkedAt }], Array.from({ length: 31 }, (_, i) => ({ name: `품목${i}`, quantity: 1 }))]) {
    assert.equal((await save(body({ items }))).status, 400);
  }
  for (const version of [-1, 0.5, '0', 2147483647]) assert.equal((await save(body({ version }))).status, 400);
  assert.equal((await save(body({ id: 'not-a-uuid' }))).status, 400);
  assert.equal(inventoryCountInput.safeParse(body({ items: [{ name: '가', quantity: 1 }, { name: '\u1100\u1161', quantity: 2 }] })).success, false);
  assert.equal((await save(body({ items: [{ name: '수건', quantity: 10000 }] }))).status, 200);
});

test('snapshot size is limited to 100 distinct items while updates at the limit remain possible', async () => {
  db.inventorySnapshot = [{ propertyId: 'p1', version: 2, items: Array.from({ length: 100 }, (_, i) => item(`품목${i}`, i)) }];
  assert.equal((await save(body({ version: 2, items: [{ name: '새 품목', quantity: 2 }] }))).status, 400);
  assert.equal(db.inventorySnapshot[0].version, 2);
  assert.equal((await save(body({ version: 2, items: [{ name: '품목0', quantity: 0 }] }))).status, 200);
  assert.equal(db.inventorySnapshot[0].items.length, 100);
});

test('same UUID and canonical payload reuses its original response even after another count; different data or actor conflicts', async () => {
  const input = body({ items: [{ name: '수건', quantity: 12 }, { name: '이불', quantity: 4 }] });
  const original = await save(input);
  assert.equal(original.status, 200);
  assert.deepEqual((await save({ ...input, items: [...input.items].reverse() })).body, original.body);
  assert.equal((await save(body({ id: secondId, version: 1, items: [{ name: '수건', quantity: 8 }] }))).status, 200);
  assert.deepEqual((await save(input)).body, original.body);
  assert.equal(db.inventorySnapshot[0].version, 2);
  assert.equal(db.inventoryCountRecord.length, 2);
  for (const changed of [body({ items: [{ name: '수건', quantity: 7 }] }), { ...input, version: 1 }]) {
    assert.equal((await save(changed)).status, 409);
  }
  actAsCleaner(['p1', 'p2']);
  assert.equal((await save({ ...input, propertyId: 'p2' })).status, 409);
  actAsAdmin();
  assert.equal((await save(input)).status, 409);
});

test('stale and concurrent versions cannot overwrite a newer physical count', async () => {
  db.inventorySnapshot = [{ propertyId: 'p1', version: 1, items: [item('수건', 10)] }];
  const results = await Promise.all([
    save(body({ version: 1, items: [{ name: '수건', quantity: 11 }] })),
    save(body({ id: secondId, version: 1, items: [{ name: '수건', quantity: 19 }] })),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.inventorySnapshot[0].version, 2);
  assert.equal(db.inventoryCountRecord.length, 1);
  assert.equal((await save(body({ id: thirdId, version: 0 }))).status, 409);
});

test('concurrent first counts create exactly one snapshot and one audit record', async () => {
  const results = await Promise.all([save(body()), save(body({ id: secondId, items: [{ name: '수건', quantity: 19 }] }))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.inventorySnapshot.length, 1);
  assert.equal(db.inventorySnapshot[0].version, 1);
  assert.equal(db.inventoryCountRecord.length, 1);
});

test('only missing inventory tables return setup fallback; unrelated DB failures are not hidden', async () => {
  const missing = Object.assign(new Error('public.inventory_snapshots does not exist'), { code: 'P2021', meta: { modelName: 'InventorySnapshot' } });
  prismaOverrides.inventorySnapshot = { findUnique: async () => { throw missing; }, findFirst: async () => { throw missing; } };
  const unavailable = await read('p1');
  assert.equal(unavailable.status, 200);
  assert.deepEqual(unavailable.body, { properties: [{ id: 'p1', name: '운와당' }], available: false, version: 0, items: [] });
  assert.equal((await read()).body.available, false);
  assert.equal((await save(body())).status, 503);
  assert.equal(db.inventoryCountRecord?.length ?? 0, 0);
  prismaOverrides.inventorySnapshot = { findUnique: async () => { throw Object.assign(new Error('connection timeout'), { code: 'P2024' }); } };
  assert.equal((await read('p1')).status, 500);
  prismaOverrides.inventorySnapshot = { findUnique: async () => { throw Object.assign(new Error('users missing'), { code: 'P2021', meta: { modelName: 'User' } }); } };
  assert.equal((await read('p1')).status, 500);
  delete prismaOverrides.inventorySnapshot;
  prismaOverrides.inventoryCountRecord = { findFirst: async () => { throw Object.assign(new Error('inventory_count_records missing'), { code: '42P01' }); } };
  assert.equal((await read()).body.available, false);
});
