import { canUseModule, isModuleEnabled } from './operational-permissions';

export interface TourActor {
  role: string;
  session: { userId: string };
  user: { organizationId?: string | null; enabledModules?: unknown };
  organizationFeatures?: unknown;
  organizationStatus?: string | null;
}
export function canManageTourOwner(actor: TourActor, owner: { id: string; organizationId?: string | null }): boolean {
  if (actor.role === 'super_admin') return true;
  if (!['admin', 'manager'].includes(actor.role) || (actor.organizationStatus && actor.organizationStatus !== 'active') || !canUseModule(actor.role, actor.user.enabledModules, 'tours') || !isModuleEnabled('tours', actor.organizationFeatures)) return false;
  if (actor.user.organizationId) return owner.organizationId === actor.user.organizationId;
  return owner.id === actor.session.userId && !owner.organizationId;
}

export function tourOwnershipWhere(actor: TourActor) {
  if (actor.role === 'super_admin') return {};
  if (!['admin', 'manager'].includes(actor.role) || (actor.organizationStatus && actor.organizationStatus !== 'active') || !canUseModule(actor.role, actor.user.enabledModules, 'tours') || !isModuleEnabled('tours', actor.organizationFeatures)) return { id: { in: [] as string[] } };
  return actor.user.organizationId ? { owner: { organizationId: actor.user.organizationId } } : { ownerId: actor.session.userId };
}
