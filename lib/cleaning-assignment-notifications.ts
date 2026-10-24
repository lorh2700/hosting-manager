import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/errors';
import { lockCleaningProperty } from '@/lib/cleaning-slots';
import { getNotifier, notifyCleaningAssigned, notifyCleaningCancelled } from '@/lib/notify';

type Role = 'primary' | 'assistant';
type DeliveryStatus = 'sent' | 'pending' | 'unknown' | 'skipped';
type Change = { role: Role; previousCleanerId: string | null; nextCleanerId: string | null };
const ACTIONS = new Set(['cleaning.interim.create', 'cleaning.interim.assign', 'cleaning.interim.cancel',
  'cleaning.assignment.assign', 'cleaning.assignment.claim', 'cleaning.assignment.release']);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 150;

function notificationDetails(value: unknown): { date: string; changes: Change[] } {
  const notification = object(object(value)?.assignmentNotification);
  if (!notification || typeof notification.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(notification.date)
    || !Array.isArray(notification.changes) || notification.changes.length < 1 || notification.changes.length > 2) throw fail(409, '청소 배정 알림 기록을 확인해 주세요.');
  const changes = notification.changes.map((value): Change => {
    const change = object(value);
    if (!change || (change.role !== 'primary' && change.role !== 'assistant')
      || (change.previousCleanerId !== null && !identifier(change.previousCleanerId))
      || (change.nextCleanerId !== null && !identifier(change.nextCleanerId))
      || change.previousCleanerId === change.nextCleanerId) throw fail(409, '청소 배정 알림 기록을 확인해 주세요.');
    return { role: change.role, previousCleanerId: change.previousCleanerId, nextCleanerId: change.nextCleanerId };
  });
  if (new Set(changes.map(change => change.role)).size !== changes.length) throw fail(409, '청소 배정 알림 기록을 확인해 주세요.');
  return { date: notification.date, changes };
}

type NotificationSenders = {
  assigned: typeof notifyCleaningAssigned;
  cancelled: typeof notifyCleaningCancelled;
  configured: () => boolean;
};
const senders: NotificationSenders = { assigned: notifyCleaningAssigned, cancelled: notifyCleaningCancelled, configured: () => getNotifier().name !== 'noop' };

export async function deliverCleaningAssignmentNotifications(auditId: string, sender: NotificationSenders = senders): Promise<{ status: DeliveryStatus }> {
  const audit = await prisma.auditLog.findUnique({ where: { id: auditId } });
  if (!audit || !ACTIONS.has(audit.action) || audit.module !== 'cleaning' || audit.outcome !== 'success'
    || audit.targetType !== 'cleaning' || !audit.targetId || !audit.propertyId || !audit.organizationId) throw fail(404, '청소 배정 알림 기록을 찾을 수 없습니다.');
  const { date, changes } = notificationDetails(audit.details);
  const deliveries = changes.flatMap(change => [
    ...(change.previousCleanerId ? [{ change, kind: 'cancelled' as const, recipientId: change.previousCleanerId }] : []),
    ...(change.nextCleanerId ? [{ change, kind: 'assigned' as const, recipientId: change.nextCleanerId }] : []),
  ]);
  const results: DeliveryStatus[] = [];
  for (const { change, kind, recipientId } of deliveries) {
    const attemptToken = randomUUID();
    const claim = await prisma.$transaction(async tx => {
      await lockCleaningProperty(tx, audit.propertyId!);
      const lockKey = `cleaning-assignment-notify:${auditId}:${change.role}:${kind}:${recipientId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))::text`;
      const where = { auditId_role_kind_recipientId: { auditId, role: change.role, kind, recipientId } };
      const existing = await tx.cleaningAssignmentNotification.findUnique({ where });
      if (existing?.state === 'sent' || existing?.state === 'skipped' || existing?.state === 'unknown') return { status: existing.state as DeliveryStatus };
      if (existing?.state === 'sending') {
        if (Date.now() - existing.updatedAt.getTime() < 120_000) return { status: 'pending' as const };
        await tx.cleaningAssignmentNotification.update({ where: { id: existing.id }, data: { state: 'unknown', lastErrorCode: 'DELIVERY_OUTCOME_UNKNOWN' } });
        return { status: 'unknown' as const };
      }
      const [property, cleaning, recipient] = await Promise.all([
        tx.property.findUnique({ where: { id: audit.propertyId! }, select: { id: true, organizationId: true, name: true } }),
        tx.cleaning.findUnique({ where: { id: audit.targetId! }, select: { id: true, propertyId: true, date: true, cleanerId: true, assistantCleanerId: true, status: true } }),
        tx.user.findUnique({ where: { id: recipientId }, select: { id: true, organizationId: true, role: true, displayName: true, phone: true, publicToken: true } }),
      ]);
      const recipientInScope = recipient?.organizationId === audit.organizationId || (recipient?.role === 'super_admin'
        && !!await tx.userProperty.findFirst({ where: { userId: recipientId, propertyId: audit.propertyId! }, select: { userId: true } }));
      const roleId = change.role === 'assistant' ? cleaning?.assistantCleanerId : cleaning?.cleanerId;
      const cancelledInterim = audit.action === 'cleaning.interim.cancel' && cleaning?.status === 'cancelled'
        && kind === 'cancelled' && change.nextCleanerId === null && roleId === change.previousCleanerId;
      const valid = property?.organizationId === audit.organizationId && cleaning?.propertyId === property?.id && cleaning?.date === date
        && (roleId === change.nextCleanerId || cancelledInterim) && recipientInScope && !!recipient?.phone
        && (kind === 'cancelled' || cleaning?.status !== 'cancelled');
      const row = existing ?? await tx.cleaningAssignmentNotification.create({ data: { auditId, role: change.role, kind, recipientId } });
      if (!valid) {
        await tx.cleaningAssignmentNotification.update({ where: { id: row.id }, data: { state: 'skipped', lastErrorCode: 'ASSIGNMENT_OR_RECIPIENT_CHANGED' } });
        return { status: 'skipped' as const };
      }
      if (!sender.configured()) {
        await tx.cleaningAssignmentNotification.update({ where: { id: row.id }, data: { state: 'failed', lastErrorCode: 'NOTIFICATION_NOT_CONFIGURED' } });
        return { status: 'pending' as const };
      }
      await tx.cleaningAssignmentNotification.update({ where: { id: row.id }, data: { state: 'sending', attemptToken, attempts: { increment: 1 }, lastErrorCode: null } });
      return { id: row.id, recipient: recipient!, property: property! };
    });
    if ('status' in claim) { results.push(claim.status!); continue; }
    let status: DeliveryStatus;
    let errorCode: string | null = null;
    try {
      const response = kind === 'assigned'
        ? await sender.assigned({ role: change.role, cleanerPhone: claim.recipient.phone, cleanerName: claim.recipient.displayName || '직원', cleanerToken: claim.recipient.publicToken,
          items: [{ propertyName: claim.property.name, date }] })
        : await sender.cancelled({ role: change.role, cleanerPhone: claim.recipient.phone, cleanerName: claim.recipient.displayName || '직원', propertyName: claim.property.name, date,
          reason: change.nextCleanerId ? 'reassigned' : 'unassigned' });
      status = response?.deliveryUnknown ? 'unknown' : response?.ok && response.provider !== 'noop' ? 'sent' : 'pending';
      errorCode = status === 'unknown' ? 'DELIVERY_OUTCOME_UNKNOWN' : status === 'pending' ? 'DELIVERY_NOT_ACCEPTED' : null;
    } catch {
      status = 'unknown'; errorCode = 'DELIVERY_OUTCOME_UNKNOWN';
    }
    const saved = await prisma.cleaningAssignmentNotification.updateMany({ where: { id: claim.id, state: 'sending', attemptToken },
      data: { state: status === 'pending' ? 'failed' : status, lastErrorCode: errorCode, sentAt: status === 'sent' ? new Date() : null } });
    results.push(saved.count === 1 ? status : 'unknown');
  }
  return { status: results.includes('unknown') ? 'unknown' : results.includes('pending') ? 'pending' : results.includes('sent') ? 'sent' : 'skipped' };
}
