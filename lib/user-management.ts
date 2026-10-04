import type { SessionAuth } from '@/lib/auth';
import { normalizeRole } from '@/lib/access';
import { fail } from '@/lib/core/errors';

type ManagedUser = { id: string; role: string; ownerId?: string | null; organizationId?: string | null };

/** Account administration is separate from the property's operational permissions. */
export function canAdministerUser(auth: SessionAuth, target: ManagedUser): boolean {
  if (auth.role === 'super_admin') return true;
  return auth.role === 'admin' && !!auth.user.organizationId
    && target.organizationId === auth.user.organizationId
    && ['manager', 'cleaner'].includes(normalizeRole(target.role));
}

export function requireUserAdministration(auth: SessionAuth, target: ManagedUser): void {
  if (!canAdministerUser(auth, target)) throw fail(403, '이 사용자를 관리할 권한이 없습니다.');
}

export function staffTenantWhere(auth: SessionAuth) {
  if (auth.role === 'super_admin') return {};
  if (!auth.user.organizationId) return { organizationId: null };
  return { organizationId: auth.user.organizationId };
}
