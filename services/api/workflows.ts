import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { fail } from '../../lib/core/errors';
import { assertOperationalAccess } from '../../lib/operational-access';
import { BACKEND_ROUTES } from '../../packages/contracts/backend-routes';
import { FIELD_ROUTES } from '../../packages/contracts/field-operations';
import { PEOPLE_EVENT_ROUTES } from '../../packages/contracts/people-events';
import { createIdentityRepository, createAccessRevisionReader } from '../../packages/data/identity-repository';
import { createEventImageStorage } from '../../packages/data/event-image-storage';
import { refreshBackendIdentity, type BackendIdentity } from '../../packages/domain/identity/access';
import { createOperationsCommandRunner } from '../../packages/domain/operations/commands';
import { createFieldOperationsService } from '../../packages/domain/field-operations/service';
import { createPeopleEventsService } from '../../packages/domain/people-events/service';
import { createEventImageUploader } from '../../packages/domain/people-events/images';
import { createReservationService } from '../../packages/domain/reservations/service';
import { createReservationCommandService } from '../../packages/domain/reservations/commands';
import { createBeds24ReservationGateway } from '../../packages/data/reservation-gateway';
import type { BackendConfig } from './config';
import type { WorkflowRequest } from './application';

function queryValues(query: URLSearchParams) {
  const values: Record<string, string> = {};
  for (const [key, value] of query) {
    if (key in values) throw fail(400, '조회 조건이 중복되었습니다.');
    values[key] = value;
  }
  return values;
}

export function createWorkflowRuntime(database: PrismaClient, config: BackendConfig, encryptionSecret: string) {
  const transaction = <T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) => database.$transaction(handler, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15_000 });
  const publicUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://voidanchae.com');
  if (!['https:', 'http:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password) throw Error('Invalid public application URL');
  const field = (db: Prisma.TransactionClient = database, run = transaction) => createFieldOperationsService({ database: db, transaction: run });
  const people = (db: Prisma.TransactionClient = database, run = transaction) => createPeopleEventsService({ database: db, transaction: run, legacyOrigin: publicUrl.origin });
  const reservations = (db: Prisma.TransactionClient = database) => createReservationService(db, { invitationSecret: config.jwtSecret, guestWebOrigin: publicUrl.origin });
  const upload = createEventImageUploader(createEventImageStorage());
  const externalReservations = createReservationCommandService({
    transaction, encryptionSecret, invitationSecret: config.jwtSecret, guestWebOrigin: publicUrl.origin,
    refreshActor: (tx, actor) => refreshBackendIdentity(actor, createIdentityRepository(tx)),
    gateway: createBeds24ReservationGateway(),
  });
  const externalRoutes = new Set(['createReservation', 'cancelReservation', 'recoverReservation', 'uploadJongnoImage']);
  const commandRoutes = new Map(BACKEND_ROUTES.filter(route => route.workflow && route.mutation && !externalRoutes.has(route.id)).map(route => [`workflow.${route.id}`, route]));
  const fieldIds = new Set(FIELD_ROUTES.map(route => route.id));
  const peopleIds = new Set(['staff', ...PEOPLE_EVENT_ROUTES.map(route => route.id)]);
  const runner = createOperationsCommandRunner<BackendIdentity>({
    transaction, encryptionSecret,
    refreshActor: (tx, actor) => refreshBackendIdentity(actor, createIdentityRepository(tx)),
    accessRevision: (tx, actor) => createAccessRevisionReader(tx)(actor),
    additionalOperations: [...commandRoutes.keys()],
    async authorizeAdditional(tx, actor, operation, target, body) {
      const route = commandRoutes.get(operation);
      if (!route) throw fail(404, '지원하지 않는 업무입니다.');
      assertOperationalAccess(actor, route.module);
      if (route.superOnly && actor.role !== 'super_admin') throw fail(403, '슈퍼매니저 권한이 필요합니다.');
      if (fieldIds.has(route.id)) await field(tx, run => run(tx)).authorizeCommand(actor, route.id, target, body);
      else if (peopleIds.has(route.id)) await people(tx, run => run(tx)).authorizeCommand(actor, route.id, target || '', body);
      else await reservations(tx).authorizeCommand(actor, route.id, target || '', body);
    },
  });

  async function dispatch(input: WorkflowRequest, db: Prisma.TransactionClient = database) {
    const { identity: actor, targetId: id, body, query } = input;
    const q = queryValues(query);
    const run = db === database ? transaction : <T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) => handler(db);
    const operations = field(db, run), staff = people(db, run), booking = reservations(db);
    switch (input.route.id) {
      case 'readInventory': return operations.readInventory(actor, q);
      case 'saveInventoryCount': return operations.saveInventoryCount(actor, body);
      case 'listLaundry': return operations.listLaundry(actor, q);
      case 'createLaundry': return operations.createLaundry(actor, body);
      case 'updateLaundry': return operations.updateLaundry(actor, id, body);
      case 'listSupplies': return operations.listSupplies(actor, q);
      case 'createSupply': return operations.createSupply(actor, body);
      case 'updateSupply': return operations.updateSupply(actor, id, body);
      case 'settlement': return operations.settlement(actor, q);
      case 'exportSettlement': return operations.exportSettlement(actor, q);
      case 'staff': return staff.listStaff(actor, { ...q, limit: q.limit === undefined ? undefined : Number(q.limit) });
      case 'staffDetail': return staff.getStaff(actor, id);
      case 'createCleaner': return staff.createCleaner(actor, body);
      case 'updateCleaner': return staff.updateCleaner(actor, id, body);
      case 'configureStaffLogin': return staff.configureStaffLogin(actor, id, body);
      case 'inviteStaff': return staff.inviteStaff(actor, id, body);
      case 'rotateStaffSchedule': return staff.rotateStaffSchedule(actor, id, body);
      case 'jongnoEvents': return staff.listJongnoEvents(actor, query);
      case 'jongnoEventDetail': return staff.getJongnoEvent(actor, id);
      case 'createJongnoEvent': return staff.createJongnoEvent(actor, body);
      case 'updateJongnoEvent': return staff.updateJongnoEvent(actor, id, body);
      case 'archiveJongnoEvent': return staff.archiveJongnoEvent(actor, id, body);
      case 'reservations': return booking.list(actor, query);
      case 'reservationDetail': return booking.detail(actor, id);
      case 'updateReservation': return booking.update(actor, id, body);
      case 'reservationInvitation': return booking.invitation(actor, id, body);
      case 'guests': return booking.guests(actor, query);
      case 'guestDetail': return booking.guestDetail(actor, id, query);
      case 'updateGuestNote': return booking.updateGuestNote(actor, id, body);
      case 'guestReviews': return booking.reviews(actor, query);
      case 'reviewGuest': return booking.review(actor, id, body);
      default: throw fail(404, '요청한 업무를 찾을 수 없습니다.');
    }
  }

  return async (input: WorkflowRequest): Promise<unknown> => {
    if (input.route.id === 'uploadJongnoImage') return upload(input.identity, input.key!, input.body);
    if (input.route.id === 'reservationAvailability') return externalReservations.availability(input.identity, input.query);
    if (input.route.id === 'reservationCommand') return externalReservations.read(input.identity, input.targetId);
    if (input.route.id === 'reservationCommands') return externalReservations.list(input.identity, input.query);
    if (input.route.id === 'recoverReservation') return externalReservations.reconcile(input.identity, input.targetId);
    if (input.route.id === 'createReservation') return externalReservations.execute(input.identity, 'create', input.key!, input.body, null);
    if (input.route.id === 'cancelReservation') return externalReservations.execute(input.identity, 'cancel', input.key!, input.body, input.targetId);
    if (!input.route.mutation) return dispatch(input);
    const result = await runner.executeCommand(input.identity, `workflow.${input.route.id}`, input.key!, input.body, input.targetId || null,
      (_service, actor, tx) => dispatch({ ...input, identity: { ...actor, requestId: input.requestId } as BackendIdentity }, tx));
    return result.data;
  };
}
