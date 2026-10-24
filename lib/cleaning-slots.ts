import type { Prisma } from '@/generated/prisma/client';
import { fail } from '@/lib/core/errors';

export type CleaningRole = 'primary' | 'assistant';
export function cleaningRole(value: unknown): CleaningRole {
  if (value === undefined || value === 'primary') return 'primary';
  if (value === 'assistant') return 'assistant';
  throw fail(400, '정담당 또는 부담당을 선택해 주세요.');
}
export function cleaningRoleFields(role: CleaningRole) {
  return role === 'assistant'
    ? { assignee: 'assistantCleanerId' as const, assignment: 'assistantAssignmentType' as const, other: 'cleanerId' as const }
    : { assignee: 'cleanerId' as const, assignment: 'assignmentType' as const, other: 'assistantCleanerId' as const };
}
export async function lockCleaningProperty(tx: Prisma.TransactionClient, propertyId: string) {
  await tx.$queryRaw`SELECT id FROM properties WHERE id=${propertyId} FOR UPDATE`;
}
export async function lockCleaningSlot(tx: Prisma.TransactionClient, propertyId: string, date: string, origin = 'auto') {
  const key = `cleaning-slot:${propertyId}:${date}:${origin === 'interim' ? 'interim' : 'checkout'}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
}
export async function requireSingleCleaning(tx: Prisma.TransactionClient, row: { id: string; propertyId: string; date: string; origin: string }) {
  const siblings = await tx.cleaning.findMany({ where: { propertyId: row.propertyId, date: row.date, status: { not: 'cancelled' },
    origin: row.origin === 'interim' ? 'interim' : { not: 'interim' } }, select: { id: true }, take: 2 });
  if (siblings.length > 1 || (siblings.length === 1 && siblings[0].id !== row.id)) {
    throw fail(409, '같은 날짜에 청소 기록이 여러 건입니다. 기존 기록을 확인한 뒤 배정해 주세요.', { code: 'CLEANING_SLOT_CONFLICT' });
  }
}
