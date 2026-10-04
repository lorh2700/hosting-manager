import { prisma } from '@/lib/prisma';
import { propertyAllowsModule } from './operational-access';
import type { OperationalModule } from './operational-permissions';
import { fail } from './core/errors';

export const operationalPropertySelect = { id: true, featureOverrides: true, organization: { select: { status: true, features: true } } } as const;
export async function propertyModuleEnabled(propertyId: string, module: OperationalModule): Promise<boolean> {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: operationalPropertySelect });
  return !!property && propertyAllowsModule(property, module);
}
export async function requirePropertyModule(propertyId: string, module: OperationalModule): Promise<void> {
  if (!await propertyModuleEnabled(propertyId, module)) throw fail(403, '현재 이 숙소에서 해당 서비스를 사용할 수 없습니다.', { code: 'service_disabled' });
}
