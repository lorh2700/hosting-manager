import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '../generated/prisma/client';
import { createOperationsService } from '../packages/domain/operations/service';
import type { OperationsActor, OperationsDatabase, OperationsTransactionRunner } from '../packages/domain/operations/types';
import { auditData } from '../packages/domain/operations/audit';
import { db, prisma, resetDb } from './stubs/prisma';

const administrator: OperationsActor = {
  role: 'admin', session: { userId: 'administrator' },
  user: { organizationId: 'business-one', displayName: '사업자 관리자' },
};
const supervisor: OperationsActor = {
  role: 'super_admin', session: { userId: 'supervisor' },
  user: { organizationId: null, displayName: '슈퍼매니저' },
};
const database = prisma as unknown as OperationsDatabase;
const transaction: OperationsTransactionRunner = handler => prisma.$transaction(handler);

beforeEach(() => {
  resetDb();
  db.organization = [
    { id: 'business-one', name: '첫 사업자', status: 'active', version: 1, features: { laundry: false } },
    { id: 'business-two', name: '다른 사업자', status: 'active', version: 1, features: {} },
  ];
  db.property = [
    { id: 'property-one', name: '첫 숙소', organizationId: 'business-one', featureVersion: 1, featureOverrides: {} },
    { id: 'property-two', name: '다른 숙소', organizationId: 'business-two', featureVersion: 1, featureOverrides: {} },
  ];
  db.user = [
    { id: 'manager-one', role: 'manager', displayName: '매니저', email: 'manager@example.invalid', status: 'active', organizationId: 'business-one', accessVersion: 1, enabledModules: null },
    { id: 'manager-two', role: 'manager', displayName: '타 사업자', email: 'other@example.invalid', status: 'active', organizationId: 'business-two', accessVersion: 1, enabledModules: null },
  ];
  db.userProperty = [{ userId: 'manager-one', propertyId: 'property-one' }];
});

test('standalone operations accepts plain queries and rejects foreign settings before accessing storage', async () => {
  let storageReads = 0;
  const unreadable = new Proxy({} as OperationsDatabase, { get() { storageReads++; throw new Error('storage should not run'); } });
  const operations = createOperationsService({ database: unreadable, transaction });
  await assert.rejects(operations.getOperationsSettings(administrator, { organizationId: 'business-two' }), { status: 403 });
  await assert.rejects(operations.listActivity(administrator, { organizationId: 'business-two' }), { status: 403 });
  await assert.rejects(operations.createOrganization(administrator, { name: '금지된 사업자' }), { status: 403 });
  assert.equal(storageReads, 0);
});

test('standalone operations keeps business options authoritative and returns only the selected business', async () => {
  const operations = createOperationsService({ database, transaction });
  const settings = await operations.getOperationsSettings(administrator);
  assert.deepEqual(settings.properties.map(property => property.id), ['property-one']);
  assert.deepEqual(settings.users.map(user => user.id), ['manager-one']);
  await assert.rejects(operations.updateOperationsSettings(administrator, {
    properties: [{ id: 'property-one', version: 1, featureOverrides: { laundry: true } }],
  }), { status: 403 });
  assert.equal(db.property[0].featureVersion, 1);
});

test('an outer command transaction can share settings updates and audit records without a nested transaction', async () => {
  let commandTransactions = 0;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const operations = createOperationsService({
      database: tx,
      transaction: async handler => { commandTransactions++; return handler(tx); },
    });
    const saved = await operations.updateUserAccess(administrator, 'manager-one', { version: 1, enabledModules: [] });
    assert.deepEqual(saved.enabledModules, []);
    assert.equal(saved.version, 2);
    assert.equal(db.auditLog.length, 1);
    await tx.auditLog.create({ data: auditData(supervisor, { action: 'command.complete', summary: '명령 결과 저장' }) });
  });
  assert.equal(commandTransactions, 1);
  assert.equal(db.user[0].accessVersion, 2);
  assert.deepEqual(db.auditLog.map(item => item.action), ['user.access.update', 'command.complete']);
});

test('failure while persisting an outer command result rolls back access changes and its activity entry', async () => {
  await assert.rejects(prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const operations = createOperationsService({ database: tx, transaction: handler => handler(tx) });
    await operations.updateUserAccess(administrator, 'manager-one', { version: 1, enabledModules: [] });
    throw new Error('command result storage unavailable');
  }), /command result storage unavailable/);
  assert.equal(db.user[0].accessVersion, 1);
  assert.equal(db.user[0].enabledModules, null);
  assert.equal((db.auditLog || []).length, 0);
});

test('standalone property approval retains the request version and creates an unpublished property', async () => {
  const operations = createOperationsService({ database, transaction });
  db.user.push({ id: 'administrator', role: 'admin', organizationId: 'business-one' });
  const requested = await operations.createPropertyRequest(administrator, { name: '새 지점' });
  await assert.rejects(operations.decidePropertyRequest(administrator, requested.id, { version: 1, status: 'approved' }), { status: 403 });
  const approved = await operations.decidePropertyRequest(supervisor, requested.id, { version: 1, status: 'approved' });
  const property = db.property.find(item => item.id === approved.propertyId);
  assert.equal(property?.organizationId, 'business-one');
  assert.equal(property?.status, 'coming_soon');
  assert.equal(approved.version, 2);
  await assert.rejects(operations.decidePropertyRequest(supervisor, requested.id, { version: 1, status: 'approved' }), { status: 409 });
  assert.equal(db.property.length, 3);
});

test('standalone activity pagination binds every page to the authenticated business', async () => {
  const operations = createOperationsService({ database, transaction });
  db.auditLog = ['a', 'b', 'c'].map(id => ({ id, organizationId: 'business-one', summary: '권한 변경', createdAt: new Date('2026-10-05T01:00:00Z') }));
  db.auditLog.push({ id: 'secret', organizationId: 'business-two', summary: '다른 사업자', createdAt: new Date('2026-10-05T02:00:00Z') });
  const first = await operations.listActivity(administrator, { pageSize: '2' });
  const second = await operations.listActivity(administrator, { pageSize: '2', cursor: first.nextCursor });
  assert.deepEqual([...first.items, ...second.items].map(item => item.id), ['c', 'b', 'a']);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
});
