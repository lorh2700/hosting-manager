import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/errors';
import { propertyAllowsModule } from '@/lib/operational-access';
import type { ApiClient } from '@/lib/api-auth';

export async function externalCleaningTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) {
      throw fail(409, '청소 일정이 변경되었습니다. 다시 조회한 뒤 시도해 주세요.', { code: 'cleaning_conflict' });
    }
    throw error;
  }
}

export async function requireExternalCleaningProperty(tx: Prisma.TransactionClient, client: ApiClient, propertyId: string) {
  if (!client.propertyIds.includes(propertyId)) throw fail(403, 'Forbidden', { code: 'property_out_of_scope' });
  const property = await tx.property.findUnique({ where: { id: propertyId },
    select: { id: true, organizationId: true, featureOverrides: true, organization: { select: { status: true, features: true } } } });
  if (!property || !propertyAllowsModule(property, 'cleaning') || !propertyAllowsModule(property, 'integrations')) {
    throw fail(403, '현재 이 숙소에서 해당 서비스를 사용할 수 없습니다.', { code: 'service_disabled' });
  }
  return property;
}

export async function recordExternalCleaningAudit(tx: Prisma.TransactionClient, client: ApiClient,
  property: { id: string; organizationId: string | null }, id: string, action: string, requestId: string | null, changedFields: string[]) {
  await tx.auditLog.create({ data: { actorId: `api-client:${client.id}`, actorName: client.name, action,
    module: 'cleaning', targetType: 'cleaning', targetId: id, propertyId: property.id,
    organizationId: property.organizationId, summary: '외부 연동 청소 일정 변경', outcome: 'success', requestId,
    details: { changedFields },
  } });
}
