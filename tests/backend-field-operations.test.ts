import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '../generated/prisma/client';
import { createFieldOperationsService } from '../packages/domain/field-operations/service';
import { applyReceipt, csvCell, currentSettlementMonth, settlementPeriod } from '../packages/domain/field-operations/rules';
import type { FieldActor, FieldDatabase } from '../packages/domain/field-operations/types';

type Row = Record<string, any>;
const clock = () => new Date('2026-10-05T03:00:00Z');
function actor(role: FieldActor['role'] = 'manager', modules: string[] | null = null): FieldActor {
  return { session: { userId: 'u1', email: 'test@example.invalid', expiresAt: 2_000_000_000 }, role, isAdmin: role === 'super_admin', isBusinessAdmin: role === 'admin', organizationId: 'org1', organizationFeatures: {}, organizationStatus: 'active',
    user: { id: 'u1', email: 'test@example.invalid', displayName: '기록 담당자', role, status: 'active', organizationId: 'org1', enabledModules: modules, organization: { id: 'org1', name: '사업자', status: 'active', features: {} }, properties: [] } };
}
function property(id = 'p1', organizationId = 'org1', features: Row = {}): Row { return { id, name: id, organizationId, organization: { id: organizationId, status: 'active', features }, featureOverrides: {}, users: [{ userId: 'u1' }] }; }
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return (Array.isArray(expected) ? expected : [expected]).every(part => matches(row, part));
    if (key === 'OR') return expected.some((part: Row) => matches(row, part));
    if (key === 'NOT') return !matches(row, expected);
    const actual = row[key];
    if (expected === null || typeof expected !== 'object' || expected instanceof Date) return actual instanceof Date && expected instanceof Date ? +actual === +expected : actual === expected;
    return Object.entries(expected).every(([op, value]: [string, any]) => {
      if (op === 'in') return value.includes(actual);
      if (op === 'lt') return actual < value;
      if (op === 'gte') return actual >= value;
      if (op === 'lte') return actual <= value;
      if (op === 'has') return Array.isArray(actual) && actual.includes(value);
      if (op === 'startsWith') return typeof actual === 'string' && actual.startsWith(value);
      if (op === 'equals') return JSON.stringify(actual) === JSON.stringify(value);
      if (op === 'some') return actual.some((part: Row) => matches(part, value));
      return false;
    });
  });
}
function fixture(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { property: [property()], inventorySnapshot: [], inventoryCountRecord: [], laundryBatch: [], supplyRequest: [], cleaning: [], event: [], booking: [], auditLog: [], ...seed };
  const calls: Array<{ model: string; args: Row }> = [];
  const db = Object.fromEntries(Object.keys(tables).map(model => [model, {
    findUnique: async ({ where }: Row) => tables[model].find(row => matches(row, where)) || null,
    findMany: async (args: Row) => { calls.push({ model, args }); const rows = tables[model].filter(row => matches(row, args.where || {}));
      for (const order of [...(Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [])].reverse()) for (const [key, direction] of Object.entries(order)) rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1));
      return rows.slice(0, args.take ?? rows.length); },
    create: async ({ data }: Row) => { const row = { createdAt: clock(), statusNote: null, ...structuredClone(data) }; tables[model].push(row); return row; },
    updateMany: async ({ where, data }: Row) => { let count = 0; for (const row of tables[model]) if (matches(row, where)) { Object.assign(row, structuredClone(data)); count++; } return { count }; },
  }])) as unknown as FieldDatabase;
  const service = createFieldOperationsService({ database: db, now: clock, transaction: async execute => { const before = structuredClone(tables); try { return await execute(db as Prisma.TransactionClient); } catch (error) { Object.assign(tables, before); throw error; } } });
  return { service, tables, calls };
}

test('inventory changes only counted items and conflicts cannot overwrite a newer count', async () => {
  const fx = fixture({ inventorySnapshot: [{ propertyId: 'p1', version: 4, items: [{ name: '수건', quantity: 9 }, { name: '이불', quantity: 3 }] }] });
  const result = await fx.service.saveInventoryCount(actor(), { propertyId: 'p1', version: 4, items: [{ name: '수건', quantity: 0 }] });
  assert.equal(result.version, 5); assert.deepEqual(result.items.map(item => [item.name, item.quantity]), [['수건', 0], ['이불', 3]]);
  assert.equal(fx.tables.inventoryCountRecord[0].checkedById, 'u1'); assert.equal(fx.tables.auditLog.length, 1);
  await assert.rejects(() => fx.service.saveInventoryCount(actor(), { propertyId: 'p1', version: 4, items: [{ name: '수건', quantity: 1 }] }), { status: 409 });
  assert.equal(fx.tables.inventoryCountRecord.length, 1);
});
test('business, assignment and module checks apply to reads and writes', async () => {
  const fx = fixture({ property: [property(), property('foreign', 'org2'), property('disabled', 'org1', { inventory: false })] });
  for (const id of ['foreign', 'disabled', 'missing']) await assert.rejects(() => fx.service.saveInventoryCount(actor(), { propertyId: id, version: 0, items: [{ name: '수건', quantity: 1 }] }), { status: 404 });
  await assert.rejects(() => fx.service.readInventory(actor('manager', []), { propertyId: 'p1' }), { status: 403 });
  assert.equal(fx.tables.inventoryCountRecord.length, 0);
});
test('cleaner inventory history is personal while the assigned property snapshot remains shared', async () => {
  const fx = fixture({ inventorySnapshot: [{ propertyId: 'p1', version: 2, items: [{ name: '수건', quantity: 2 }] }], inventoryCountRecord: [{ id: 'one', propertyId: 'p1', checkedById: 'u1', checkedBy: '본인', checkedAt: clock(), items: [], version: 1 }, { id: 'two', propertyId: 'p1', checkedById: 'u2', checkedBy: '다른 담당자', checkedAt: clock(), items: [], version: 2 }] });
  const result = await fx.service.readInventory(actor('cleaner'), { propertyId: 'p1' });
  assert.equal(result.version, 2); assert.equal(result.history.length, 1); assert.equal(result.history[0].checkedBy, '본인');
  assert.equal(fx.calls.find(call => call.model === 'inventoryCountRecord')?.args.take, 21);
});
test('quick laundry shipment, partial defective receipt and full receipt preserve stock separation', async () => {
  const fx = fixture();
  const batch = await fx.service.createLaundry(actor('cleaner'), { propertyId: 'p1', items: [{ name: '수건', quantity: 5 }] });
  assert.equal(batch.vendor, ''); assert.equal(batch.deliveryDate, ''); assert.equal(batch.status, 'collected');
  const partial = await fx.service.updateLaundry(actor('cleaner'), batch.id, { version: 1, action: 'receive', incoming: [{ name: '수건', quantity: 3, damaged: 1, rewash: 1 }] });
  assert.equal(partial?.status, 'partial'); assert.equal((partial?.items as Row[])[0].received, 3);
  const full = await fx.service.updateLaundry(actor('cleaner'), batch.id, { version: 2, action: 'receive', full: true });
  assert.equal(full?.status, 'completed'); assert.equal((full?.items as Row[])[0].damaged, 1); assert.equal((full?.history as Row[]).length, 3);
  assert.equal(fx.tables.inventorySnapshot.length, 0);
  await assert.rejects(() => fx.service.updateLaundry(actor('cleaner'), batch.id, { version: 3, action: 'correct', note: '정정', items: [{ name: '수건', sent: 5, received: 5 }] }), { status: 403 });
});
test('laundry ownership, version and over-receipt errors do not append history', async () => {
  const fx = fixture(); const batch = await fx.service.createLaundry(actor(), { propertyId: 'p1', items: [{ name: '수건', quantity: 2 }] });
  const other = actor('cleaner'); other.session.userId = 'u2';
  await assert.rejects(() => fx.service.updateLaundry(other, batch.id, { version: 1, action: 'receive', full: true }), { status: 404 });
  await assert.rejects(() => fx.service.updateLaundry(actor(), batch.id, { version: 0, action: 'receive', full: true }), { status: 400 });
  await assert.rejects(() => fx.service.updateLaundry(actor(), batch.id, { version: 1, action: 'receive', incoming: [{ name: '수건', quantity: 3 }] }), { status: 400 });
  assert.equal(fx.tables.laundryBatch[0].history.length, 1);
  const corrected = await fx.service.updateLaundry(actor(), batch.id, { version: 1, action: 'correct', note: '실제 출고 수량 확인', items: [{ name: '수건', sent: 3, received: 0 }] });
  assert.equal((corrected?.items as Row[])[0].sent, 3); assert.equal((corrected?.history as Row[])[1].note, '실제 출고 수량 확인');
});
test('supplies use text and server actor/time with enforced processing transitions', async () => {
  const fx = fixture(); const request = await fx.service.createSupply(actor('cleaner'), { propertyId: 'p1', text: '생수 2박스\n세제', urgency: 'urgent' });
  assert.equal(request.requestText, '생수 2박스\n세제'); assert.equal(request.version, 1);
  await assert.rejects(() => fx.service.updateSupply(actor('cleaner'), request.id, { version: 1, status: 'approved' }), { status: 403 });
  await assert.rejects(() => fx.service.updateSupply(actor(), request.id, { version: 1, status: 'completed' }), { status: 409 });
  const approved = await fx.service.updateSupply(actor(), request.id, { version: 1, status: 'approved', note: '구매 예정' });
  assert.equal(approved.processedBy, '기록 담당자'); assert.equal(approved.processedAt, clock().toISOString());
  await assert.rejects(() => fx.service.updateSupply(actor(), request.id, { version: 1, status: 'completed' }), { status: 409 });
  const completed = await fx.service.updateSupply(actor(), request.id, { version: 2, status: 'completed', note: '숙소 전달' });
  assert.equal(completed.history.length, 3); assert.equal(completed.status, 'completed');
});
test('settlement is 26–25, excludes check-in-only ghost completions and inquiries, and retains manual cleaning', async () => {
  const cleaning = (id: string, date: string, extra: Row = {}) => ({ id, propertyId: 'p1', date, status: 'done', origin: 'auto', cleanerId: 'u1', cleaner: { displayName: '=담당자' }, ...extra });
  const fx = fixture({ cleaning: [cleaning('valid', '2026-09-28'), cleaning('ghost', '2026-09-27'), cleaning('inquiry', '2026-10-01'), cleaning('manual', '2026-10-02', { origin: 'manual' }), cleaning('unassigned', '2026-10-03', { origin: 'manual', cleanerId: null }), cleaning('cancelled', '2026-10-04', { origin: 'manual', status: 'cancelled' }), cleaning('before', '2026-09-25', { origin: 'manual' })],
    event: [{ propertyId: 'p1', type: 'reservation', startDate: '2026-09-27', endDate: '2026-09-28', tags: [], title: null }, { propertyId: 'p1', type: 'reservation', endDate: '2026-10-01', tags: ['inquiry'], title: '문의' }],
  });
  const result = await fx.service.settlement(actor(), { month: '2026-10' });
  assert.deepEqual(result.period, { month: '2026-10', from: '2026-09-26', to: '2026-10-25' });
  assert.equal(result.totals.done, 2); assert.equal(result.totals.review, 3); assert.deepEqual(result.details.map(row => row.id), ['valid', 'manual']);
  const csv = await fx.service.exportSettlement(actor(), { month: '2026-10' });
  assert.ok(csv.content.startsWith('\uFEFF')); assert.ok(csv.content.includes("'=담당자")); assert.ok(csv.content.includes('실제 퇴실 일정 확인 필요'));
  await assert.rejects(() => fx.service.exportSettlement(actor('cleaner'), { month: '2026-10' }), { status: 403 });
  await assert.rejects(() => fx.service.settlement(actor('manager', ['inventory']), { month: '2026-10' }), { status: 403 });
});
test('replay authorization checks current module and scope without requiring the old version', async () => {
  const fx = fixture(); const row = await fx.service.createSupply(actor(), { propertyId: 'p1', text: '생수' });
  await fx.service.updateSupply(actor(), row.id, { version: 1, status: 'approved' });
  await fx.service.authorizeCommand(actor(), 'updateSupply', row.id, { version: 1, status: 'approved' });
  await assert.rejects(() => fx.service.authorizeCommand(actor('manager', []), 'updateSupply', row.id, { version: 1, status: 'approved' }), { status: 403 });
});
test('cancelled bookings and title-only inquiries cannot justify automatic settlement', async () => {
  const cleaning = (id: string, date: string, status = 'done') => ({ id, propertyId: 'p1', date, status, origin: 'auto', cleanerId: 'u1', cleaner: { displayName: '담당자' } });
  const fx = fixture({
    cleaning: [cleaning('confirmed', '2026-10-08'), cleaning('cancelled-complete', '2026-10-09'), cleaning('cancelled-pending', '2026-10-10', 'pending'), cleaning('title-inquiry', '2026-10-11')],
    booking: [{ propertyId: 'p1', checkOut: '2026-10-08', status: 'confirmed' }, { propertyId: 'p1', checkOut: '2026-10-09', status: 'cancelled' }, { propertyId: 'p1', checkOut: '2026-10-10', status: 'cancelled' }],
    event: [{ propertyId: 'p1', type: 'reservation', endDate: '2026-10-11', tags: [], title: '[문의] 예약 전 문의' }],
  });
  const result = await fx.service.settlement(actor(), { month: '2026-10' });
  assert.deepEqual(result.totals, { done: 1, pending: 0, review: 2 });
  assert.deepEqual(result.details.map(row => row.id), ['confirmed']);
  assert.deepEqual(result.review.map(row => row.id), ['cancelled-complete', 'title-inquiry']);
});

test('settlement year transitions and receipt validation remain explicit', () => {
  assert.deepEqual(settlementPeriod('2027-01'), { month: '2027-01', from: '2026-12-26', to: '2027-01-25' });
  assert.equal(currentSettlementMonth(new Date('2026-12-25T15:00:00Z')), '2027-01');
  assert.equal(currentSettlementMonth(new Date('2026-12-25T14:59:00Z')), '2026-12');
  assert.throws(() => applyReceipt([{ name: '수건', sent: 3, received: 0, damaged: 0, rewash: 0 }], [{ name: '수건', quantity: 1, damaged: 1, rewash: 1 }]), { status: 400 });
  assert.equal(csvCell('a,"b'), '"a,""b"');
});
