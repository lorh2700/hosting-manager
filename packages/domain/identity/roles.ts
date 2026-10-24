import type { UserRole } from '../../../lib/types';

export function normalizeRole(raw: string | null | undefined): UserRole {
  switch (raw) {
    case 'super_admin':
    case 'admin':
    case 'cleaner':
      return raw;
    default:
      return 'manager';
  }
}
