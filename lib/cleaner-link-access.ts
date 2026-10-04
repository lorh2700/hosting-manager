import { prisma } from '@/lib/prisma';
import { normalizeRole } from '@/lib/access';
import { canUseModule, isModuleEnabled } from '@/lib/operational-permissions';
import { propertyAllowsModule, scopedAssignedPropertyIds } from '@/lib/operational-access';

/** Private calendar links are credentials, but never replace current account and business access. */
export async function resolveCleanerLink(token: string) {
  if (!token || token.length > 200) return null;
  const user = await prisma.user.findUnique({ where: { publicToken: token }, select: {
    id: true, displayName: true, role: true, status: true, organizationId: true, enabledModules: true,
    organization: { select: { status: true, features: true } },
    properties: { select: { propertyId: true, property: { select: {
      organizationId: true, featureOverrides: true, organization: { select: { status: true, features: true } },
    } } } },
  } });
  if (!user || !['active', 'no_account'].includes(user.status)) return null;
  const role = normalizeRole(user.role);
  if (user.organizationId && (!user.organization || user.organization.status !== 'active')) return null;
  if (!canUseModule(role, user.enabledModules, 'cleaning') || !isModuleEnabled('cleaning', user.organization?.features)) return null;
  const propertyIds = ['super_admin', 'admin'].includes(role)
    ? role === 'admin' && !user.organizationId ? [] : (await prisma.property.findMany({
      where: role === 'super_admin' ? {} : { organizationId: user.organizationId },
      select: { id: true, featureOverrides: true, organization: { select: { status: true, features: true } } },
    })).filter(property => propertyAllowsModule(property, 'cleaning')).map(property => property.id)
    : scopedAssignedPropertyIds(user.organizationId, user.properties, 'cleaning');
  return { id: user.id, name: user.displayName || '직원', propertyIds };
}
