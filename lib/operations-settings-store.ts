import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { createOperationsService } from '@/packages/domain/operations/service';
import type { OperationsActor, ActivityQuery } from '@/packages/domain/operations/types';

export { settingsDatabase } from '@/packages/domain/operations/service';

const operations = createOperationsService({
  database: prisma,
  transaction: handler => prisma.$transaction(handler, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
});

export const {
  createOrganization,
  updateOrganization,
  updateOperationsSettings,
  updateUserAccess,
  inviteBusinessAdministrator,
  createPropertyRequest,
  decidePropertyRequest,
} = operations;

export function listOrganizations(auth: OperationsActor, req?: Request) {
  return operations.listOrganizations(auth, { picker: req ? new URL(req.url).searchParams.get('picker') === '1' : false });
}

export function getOperationsSettings(auth: OperationsActor, req?: Request) {
  return operations.getOperationsSettings(auth, { organizationId: req ? new URL(req.url).searchParams.get('organizationId') : null });
}

export function listPropertyRequests(auth: OperationsActor, req: Request) {
  const query = new URL(req.url).searchParams;
  return operations.listPropertyRequests(auth, {
    organizationId: query.get('organizationId'),
    status: query.get('status'),
    cursor: query.get('cursor'),
  });
}

export function listActivity(auth: OperationsActor, req: Request) {
  const params = new URL(req.url).searchParams;
  const query: ActivityQuery = {};
  for (const key of ['organizationId', 'propertyId', 'pageSize', 'module', 'outcome', 'from', 'to', 'cursor', 'actorId', 'search'] as const) {
    query[key] = params.get(key);
  }
  return operations.listActivity(auth, query);
}
