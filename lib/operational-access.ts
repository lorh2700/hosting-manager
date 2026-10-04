import type { UserRole } from './types';
import { canUseModule, isModuleEnabled, moduleForApiPath, type OperationalModule } from './operational-permissions';
import { fail } from './core/errors';

export interface OperationalIdentity {
  role: UserRole;
  user: { enabledModules?: unknown; organizationId?: string | null };
  operationalModule?: OperationalModule | null;
  organizationFeatures?: unknown;
  organizationStatus?: string | null;
}

/** Cleaning calendars read shared stay dates; the same endpoint never grants reservation writes. */
export function requestOperationalModule(req: Request, auth: OperationalIdentity, routeName?: string): OperationalModule | null {
  const path = new URL(req.url).pathname;
  const operationalModule = moduleForApiPath(path, req.method || 'GET') ?? (routeName ? moduleForApiPath(`/api/${routeName}`, req.method || 'GET') : null);
  if ((req.method || 'GET') === 'GET' && (path === '/api/events' || path === '/api/cleaners' || routeName === 'staff/assignees')) {
    if (path === '/api/cleaners' || routeName === 'staff/assignees' || auth.role === 'cleaner' || (operationalModule === 'reservations' && auth.role !== 'super_admin' &&
      (!canUseModule(auth.role, auth.user.enabledModules, 'reservations') || !isModuleEnabled('reservations', auth.organizationFeatures)))) return 'cleaning';
  }
  return operationalModule;
}

export async function isSelfProfileRequest(req: Request, userId: string): Promise<boolean> {
  if (req.method !== 'PUT' || new URL(req.url).pathname !== '/api/users') return false;
  try {
    const body = await req.clone().json();
    return !!body && typeof body === 'object' && !Array.isArray(body) && (body.id === undefined || body.id === userId);
  } catch { return false; }
}

/** A reservation operator need not see channel settings, but a disabled provider must stay disconnected. */
export function requestFeatureModules(req: Request, module: OperationalModule | null): OperationalModule[] {
  const modules: OperationalModule[] = module ? [module] : [];
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET') && new URL(req.url).pathname.startsWith('/api/beds24/')) modules.push('integrations');
  return [...new Set(modules)];
}

export function assertOperationalAccess(auth: OperationalIdentity, module: OperationalModule | null, featureModules: OperationalModule[] = []): void {
  if (auth.role === 'super_admin') return;
  if (auth.organizationStatus && auth.organizationStatus !== 'active') throw fail(403, '사용이 중지된 사업자입니다.');
  if ((module && (!canUseModule(auth.role, auth.user.enabledModules, module) || !isModuleEnabled(module, auth.organizationFeatures))) || featureModules.some(feature => !isModuleEnabled(feature, auth.organizationFeatures))) {
    throw fail(403, '이 기능의 사용 권한이 없거나 사업자 옵션이 꺼져 있습니다.');
  }
}

export function propertyAllowsModule(property: { featureOverrides?: unknown; organization?: { features?: unknown; status?: string } | null }, module?: OperationalModule | null): boolean {
  if (property.organization?.status && property.organization.status !== 'active') return false;
  return !module || isModuleEnabled(module, property.organization?.features, property.featureOverrides);
}

export function scopedAssignedPropertyIds(organizationId: string | null | undefined,
  assignments: Array<{ propertyId: string; property: { organizationId?: string | null; featureOverrides?: unknown; organization?: { features?: unknown; status?: string } | null } }>,
  module?: OperationalModule | null, featureModules: OperationalModule[] = []): string[] {
  return assignments.filter(item => (item.property.organizationId ?? null) === (organizationId ?? null) && propertyAllowsModule(item.property, module) && featureModules.every(feature => propertyAllowsModule(item.property, feature))).map(item => item.propertyId);
}
