import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../../lib/core/errors';
import { assertOperationalAccess, propertyAllowsModule } from '../../../lib/operational-access';
import { canUseModule, isModuleEnabled, OPERATIONAL_MODULES, type OperationalModule } from '../../../lib/operational-permissions';
import type { BackendIdentity } from '../identity/access';

export const MAX_READ_PROPERTIES = 20;
export const MAX_READ_ROWS = 5_000;

export interface ReadPropertyPolicy {
  featureOverrides: unknown;
  organization: { status: string; features: unknown } | null;
}

export function assertReadIdentity(identity: BackendIdentity): void {
  if (identity.user.status !== 'active') throw readError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  assertOperationalAccess(identity, null);
}

export function readError(status: number, code: string, message: string) {
  return Object.assign(fail(status, message, { code }), { code });
}

export function propertyScopeWhere(identity: BackendIdentity): Prisma.PropertyWhereInput {
  assertReadIdentity(identity);
  if (identity.role === 'super_admin') return {};
  if (identity.role === 'admin') return identity.organizationId
    ? { organizationId: identity.organizationId }
    : { id: { in: [] } };
  return { organizationId: identity.organizationId, users: { some: { userId: identity.user.id } } };
}

export function moduleAllowed(identity: BackendIdentity, module: OperationalModule, property?: ReadPropertyPolicy): boolean {
  if (identity.role === 'super_admin') return true;
  return canUseModule(identity.role, identity.user.enabledModules, module) &&
    isModuleEnabled(module, identity.organizationFeatures) && (!property || propertyAllowsModule(property, module));
}

export function operationalModules(identity: BackendIdentity, property?: ReadPropertyPolicy): OperationalModule[] {
  return OPERATIONAL_MODULES.map(item => item.key).filter(module => moduleAllowed(identity, module, property));
}

export function readCapabilities(identity: BackendIdentity, property?: ReadPropertyPolicy): string[] {
  const capabilities = ['properties.read'];
  if (moduleAllowed(identity, 'reservations', property)) capabilities.push('operations.today.read', 'operations.calendar.read',
    'reservations.read', 'reservations.create', 'reservations.update', 'reservations.cancel', 'reservations.invitation', 'guests.read', 'guests.update', 'guests.review');
  if (moduleAllowed(identity, 'cleaning', property)) capabilities.push('cleaning.schedule.read');
  if (moduleAllowed(identity, 'inventory', property)) capabilities.push('inventory.read', 'inventory.record');
  if (moduleAllowed(identity, 'laundry', property)) capabilities.push('laundry.read', 'laundry.record', ...(identity.role === 'cleaner' ? [] : ['laundry.manage']));
  if (moduleAllowed(identity, 'supplies', property)) capabilities.push('supplies.read', 'supplies.request', ...(identity.role === 'cleaner' ? [] : ['supplies.manage']));
  if (identity.role !== 'cleaner' && moduleAllowed(identity, 'settlement', property)) capabilities.push('settlement.read');
  if (!property && moduleAllowed(identity, 'staff')) capabilities.push('staff.read', 'staff.manage', ...(['super_admin', 'admin'].includes(identity.role) ? ['staff.access.manage'] : []));
  if (!property && ['super_admin', 'admin'].includes(identity.role)) capabilities.push('settings.read', 'property.request.create', 'activity.read');
  if (!property && identity.role === 'super_admin') capabilities.push('organizations.manage', 'jongno-events.manage');
  return capabilities;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export function readIdentityRevision(identity: BackendIdentity): string {
  const assignments = identity.user.properties.map(item => item.property).sort((a, b) => a.id.localeCompare(b.id));
  const policy = { id: identity.user.id, role: identity.role, status: identity.user.status,
    organizationId: identity.organizationId, organization: identity.user.organization,
    enabledModules: identity.user.enabledModules, accessVersion: identity.user.accessVersion, assignments };
  return createHash('sha256').update(JSON.stringify(stableValue(policy))).digest('base64url');
}

export function requestedPropertyIds(value?: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_READ_PROPERTIES || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) {
    throw readError(400, 'RANGE_TOO_LARGE', `숙소는 한 번에 ${MAX_READ_PROPERTIES}개까지 조회할 수 있습니다.`);
  }
  return [...new Set(value)];
}

export function assertRowLimit(count: number): void {
  if (count > MAX_READ_ROWS) throw readError(400, 'RANGE_TOO_LARGE', '일정이 많습니다. 숙소를 나누어 조회해 주세요.');
}
