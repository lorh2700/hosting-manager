import type { Prisma } from '@/generated/prisma/client';
import type { UserRole } from '@/lib/types';

export interface OperationsActor {
  requestId?: string;
  role: UserRole;
  session: { userId: string };
  user: { organizationId?: string | null; displayName?: string | null; email?: string };
}

export type OperationsDatabase = Pick<Prisma.TransactionClient,
  'organization' | 'property' | 'user' | 'userProperty' | 'invitation' | 'propertyRequest' | 'auditLog'>;

export type OperationsTransactionRunner = <T>(handler: (transaction: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export interface OrganizationQuery {
  picker?: boolean;
}

export interface SettingsQuery {
  organizationId?: string | null;
}

export interface PropertyRequestsQuery extends SettingsQuery {
  status?: string | null;
  cursor?: string | null;
}

export interface ActivityQuery extends SettingsQuery {
  propertyId?: string | null;
  pageSize?: string | null;
  module?: string | null;
  outcome?: string | null;
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  actorId?: string | null;
  search?: string | null;
}
