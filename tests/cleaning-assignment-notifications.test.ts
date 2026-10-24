import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, resetDb } from './stubs/prisma';
import { deliverCleaningAssignmentNotifications } from '../lib/cleaning-assignment-notifications';
import { POST } from '../app/api/internal/cleaning-assignment-notifications/route';
import { resetNotify, notifyCalls } from './stubs/notify';
import type { NotifyResult } from '../lib/notify';

const date = '2026-10-22';
const change = (role = 'primary', previousCleanerId: string | null = 'old', nextCleanerId: string | null = 'new') => ({ role, previousCleanerId, nextCleanerId });
const audit = (changes = [change()]) => ({ id: 'audit', action: 'cleaning.assignment.assign', module: 'cleaning', outcome: 'success', targetType: 'cleaning',
  targetId: 'cleaning', propertyId: 'p', organizationId: 'org', details: { assignmentNotification: { date, changes } } });
beforeEach(() => {
  resetDb(); resetNotify(); process.env.BACKEND_BRIDGE_SECRET = 'bridge-key-for-test-at-least-32-characters';
  db.property = [{ id: 'p', name: '숙소', organizationId: 'org' }];
  db.user = ['old', 'new', 'assistant'].map(id => ({ id, displayName: id, phone: `010-${id}`, organizationId: 'org', publicToken: 'public' }));
  db.cleaning = [{ id: 'cleaning', propertyId: 'p', date, cleanerId: 'new', assistantCleanerId: null, status: 'pending' }];
  db.auditLog = [audit()];
});

test('internal bridge accepts only authenticated audit identifiers and checks immutable action scope', async () => {
  const request = (body: unknown, key = process.env.BACKEND_BRIDGE_SECRET) => new Request('http://test/api/internal/cleaning-assignment-notifications', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-backend-key': key || '' }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ auditId: 'audit' }, 'bad'))).status, 401);
  assert.equal((await POST(request({ auditId: 'audit', phone: '01012345678' }))).status, 400);
  db.auditLog[0].outcome = 'denied';
  assert.equal((await POST(request({ auditId: 'audit' }))).status, 404);
  assert.equal(notifyCalls.assigned.length, 0);
  db.auditLog[0].outcome = 'success'; db.auditLog[0].action = 'staff.create';
  assert.equal((await POST(request({ auditId: 'audit' }))).status, 404);
});

test('concurrent and repeated delivery sends only changed roles once', async () => {
  const results = await Promise.all([deliverCleaningAssignmentNotifications('audit'), deliverCleaningAssignmentNotifications('audit')]);
  assert.ok(results.some(row => row.status === 'sent'));
  assert.equal((await deliverCleaningAssignmentNotifications('audit')).status, 'sent');
  assert.equal(notifyCalls.cancelled.length, 1); assert.equal(notifyCalls.assigned.length, 1);
  assert.equal(notifyCalls.cancelled[0].role, 'primary'); assert.equal(notifyCalls.assigned[0].cleanerName, 'new');
  assert.equal(db.cleaningAssignmentNotification.length, 2);
  assert.ok(db.cleaningAssignmentNotification.every(row => row.state === 'sent'));
  assert.ok(!JSON.stringify(db.cleaningAssignmentNotification).includes('010-'));
});

test('definite failure remains retryable while uncertain transport is not resent', async () => {
  db.auditLog = [audit([change('assistant', null, 'assistant')])]; db.cleaning[0].assistantCleanerId = 'assistant';
  let count = 0;
  let response: NotifyResult = { ok: false, provider: 'test', error: 'rejected' };
  const sender = { configured: () => true, assigned: async () => { count++; return response; }, cancelled: async () => response };
  assert.equal((await deliverCleaningAssignmentNotifications('audit', sender)).status, 'pending');
  assert.equal(db.cleaningAssignmentNotification[0].state, 'failed');
  response = { ok: true, provider: 'test' };
  assert.equal((await deliverCleaningAssignmentNotifications('audit', sender)).status, 'sent'); assert.equal(count, 2);
  db.auditLog[0].id = 'uncertain';
  response = { ok: false, provider: 'test', deliveryUnknown: true };
  assert.equal((await deliverCleaningAssignmentNotifications('uncertain', sender)).status, 'unknown');
  assert.equal((await deliverCleaningAssignmentNotifications('uncertain', sender)).status, 'unknown'); assert.equal(count, 3);
});

test('stale assignments, other business recipients, or other business properties never receive notices', async () => {
  db.cleaning[0].cleanerId = 'assistant';
  assert.equal((await deliverCleaningAssignmentNotifications('audit')).status, 'skipped');
  assert.equal(notifyCalls.cancelled.length + notifyCalls.assigned.length, 0);
  db.auditLog[0].id = 'other-recipient'; db.cleaning[0].cleanerId = 'new'; db.user.forEach(row => { row.organizationId = 'other'; });
  assert.equal((await deliverCleaningAssignmentNotifications('other-recipient')).status, 'skipped');
  db.auditLog[0].id = 'other-property'; db.property[0].organizationId = 'other'; db.user.forEach(row => { row.organizationId = 'org'; });
  assert.equal((await deliverCleaningAssignmentNotifications('other-property')).status, 'skipped');
  assert.equal(notifyCalls.cancelled.length + notifyCalls.assigned.length, 0);
});

test('cancelled interim keeps historical assignees and notifies each role without assignment sends', async () => {
  db.cleaning[0].status = 'cancelled'; db.cleaning[0].assistantCleanerId = 'assistant';
  db.auditLog = [audit([change('primary', 'new', null), change('assistant', 'assistant', null)])]; db.auditLog[0].action = 'cleaning.interim.cancel';
  assert.equal((await deliverCleaningAssignmentNotifications('audit')).status, 'sent');
  assert.deepEqual(notifyCalls.cancelled.map(row => row.role), ['primary', 'assistant']); assert.equal(notifyCalls.assigned.length, 0);
});

test('an abandoned sending claim becomes unknown without sending a duplicate', async () => {
  db.auditLog = [audit([change('assistant', null, 'assistant')])]; db.cleaning[0].assistantCleanerId = 'assistant';
  db.cleaningAssignmentNotification = [{ id: 'delivery', auditId: 'audit', role: 'assistant', kind: 'assigned', recipientId: 'assistant', state: 'sending', updatedAt: new Date(Date.now() - 180_000) }];
  assert.equal((await deliverCleaningAssignmentNotifications('audit')).status, 'unknown'); assert.equal(notifyCalls.assigned.length, 0);
});

test('explicitly assigned super manager can receive their cleaning role notification', async () => {
  db.auditLog = [audit([change('assistant', null, 'assistant')])]; db.cleaning[0].assistantCleanerId = 'assistant';
  Object.assign(db.user[2], { role: 'super_admin', organizationId: null });
  db.userProperty = [{ userId: 'assistant', propertyId: 'p' }];
  assert.equal((await deliverCleaningAssignmentNotifications('audit')).status, 'sent');
  assert.equal(notifyCalls.assigned.length, 1);
  db.auditLog[0].id = 'no-longer-assigned'; db.userProperty = [];
  assert.equal((await deliverCleaningAssignmentNotifications('no-longer-assigned')).status, 'skipped');
  assert.equal(notifyCalls.assigned.length, 1);
});
