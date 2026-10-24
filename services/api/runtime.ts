import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { fail } from '../../lib/core/errors';
import { assertOperationalAccess } from '../../lib/operational-access';
import { createIdentityRepository, createAccessRevisionReader } from '../../packages/data/identity-repository';
import { authenticateLegacySession, refreshBackendIdentity, type BackendIdentity } from '../../packages/domain/identity/access';
import { createOperationsService } from '../../packages/domain/operations/service';
import { createOperationsCommandRunner, type OperationsCommandOperation } from '../../packages/domain/operations/commands';
import { BackendReadService } from '../../packages/domain/reads/service';
import type { BackendDependencies } from './application';
import type { BackendConfig } from './config';
import { createWorkflowRuntime } from './workflows';

const commandOperations: Record<string, OperationsCommandOperation> = {
  createOrganization: 'organization.create', updateOrganization: 'organization.update', inviteAdministrator: 'organization.admin.invite',
  updateSettings: 'operations.settings.update', updateUserAccess: 'user.access.update', createPropertyRequest: 'property.request.create', decidePropertyRequest: 'property.request.decide',
};

function readQuery(query: URLSearchParams) {
  for (const name of ['month', 'date', 'limit', 'cursor', 'organizationId']) if (query.getAll(name).length > 1) throw fail(400, '중복된 조회 조건입니다.');
  const propertyIds = query.has('propertyId') ? query.getAll('propertyId') : undefined;
  return {
    cursor: query.get('cursor') ?? undefined,
    limit: query.has('limit') ? Number(query.get('limit')) : undefined,
    date: query.get('date') ?? undefined,
    month: query.get('month') ?? undefined,
    organizationId: query.get('organizationId') ?? undefined,
    propertyIds,
  };
}

export function createBackendDependencies(database: PrismaClient, config: BackendConfig, encryptionSecret: string): BackendDependencies {
  const repository = createIdentityRepository(database);
  const revisionReader = createAccessRevisionReader(database);
  const revisions = new WeakMap<BackendIdentity, Promise<string>>();
  const accessRevision = (identity: BackendIdentity) => {
    let revision = revisions.get(identity);
    if (!revision) { revision = revisionReader(identity); revisions.set(identity, revision); }
    return revision;
  };
  const transaction = <T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) =>
    database.$transaction(handler, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10_000 });
  const operations = createOperationsService({ database, transaction });
  const reads = new BackendReadService(database, { accessRevision });
  const commands = createOperationsCommandRunner<BackendIdentity>({
    transaction,
    refreshActor: (tx, previous) => refreshBackendIdentity(previous, createIdentityRepository(tx)),
    accessRevision: (tx, actor) => createAccessRevisionReader(tx)(actor),
    encryptionSecret,
  });
  return {
    authenticate: headers => authenticateLegacySession(headers, { secret: config.jwtSecret, repository }),
    accessRevision, operations, workflow: createWorkflowRuntime(database, config, encryptionSecret),
    async read(route, identity, query) {
      const input = readQuery(query);
      switch (route) {
        case 'bootstrap': return reads.bootstrap(identity, input);
        case 'properties': return reads.properties(identity, input);
        case 'staff': return reads.staff(identity, input);
        case 'today': return reads.today(identity, input);
        case 'calendar': return reads.calendar(identity, input);
        case 'cleanerCalendar': return reads.calendar(identity, { ...input, cleaner: true });
        default: throw fail(404, '요청한 기능을 찾을 수 없습니다.');
      }
    },
    async command(input, execute) {
      const operation = commandOperations[input.route.id];
      if (!operation) throw fail(404, '지원하지 않는 변경 요청입니다.');
      const result = await commands.executeCommand(input.identity, operation, input.key, input.body, input.targetId || null, async (service, actor) => {
        assertOperationalAccess(actor, input.route.module);
        return execute(service, { ...actor, requestId: input.requestId } as BackendIdentity);
      });
      return result.data;
    },
    async ready() {
      await database.$queryRaw`SELECT id, access_version FROM users WHERE false`;
      await database.$queryRaw`SELECT id, features FROM organizations WHERE false`;
      await database.$queryRaw`SELECT id FROM backend_commands WHERE false`;
      await database.$queryRaw`SELECT id FROM backend_reservation_commands WHERE false`;
      await database.$queryRaw`SELECT reservation_id FROM backend_reservation_annotations WHERE false`;
      await database.$queryRaw`SELECT organization_id FROM backend_guest_notes WHERE false`;
    },
    close: () => database.$disconnect(),
    log: entry => console.log(JSON.stringify({ component: 'staff-api', ...entry })),
  };
}
