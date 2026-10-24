import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { fail } from '@/lib/core/errors';
import { normalizeRole } from '../identity/roles';
import { createOperationsService, type OperationsService } from './service';
import type { OperationsActor, OperationsTransactionRunner } from './types';

const operations = [
  'organization.create', 'organization.update', 'organization.admin.invite',
  'operations.settings.update', 'user.access.update', 'property.request.create', 'property.request.decide',
] as const;
export type OperationsCommandOperation = typeof operations[number];

export interface OperationsCommandActor extends OperationsActor {
  session: { userId: string; expiresAt: number };
  user: OperationsActor['user'] & { status: string };
  organizationStatus?: string;
}

interface CommandRecord {
  id: string;
  request_hash: string;
  access_revision: string;
  status: string;
  result_ciphertext: string | null;
}

function commandError(status: number, code: string, message: string, retryable = false) {
  return fail(status, message, { code, retryable });
}

function canonicalJson(value: unknown): string {
  let count = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++count > 20_000 || depth > 20) throw commandError(400, 'INVALID_COMMAND', '요청 내용이 너무 큽니다.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(entry => visit(entry, depth + 1));
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit((item as Record<string, unknown>)[key], depth + 1)]));
    }
    throw commandError(400, 'INVALID_COMMAND', '요청 내용은 올바른 JSON이어야 합니다.');
  };
  const json = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(json) > 128 * 1024) throw commandError(400, 'INVALID_COMMAND', '요청 내용이 너무 큽니다.');
  return json;
}

function jsonBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

async function authorizeTarget(tx: Prisma.TransactionClient, actor: OperationsCommandActor, operation: OperationsCommandOperation, target: string | null, body: unknown) {
  if (!['super_admin', 'admin'].includes(actor.role)) throw commandError(403, 'FORBIDDEN', '사업자 관리자 권한이 필요합니다.');
  if (actor.role === 'super_admin') return;
  const organizationId = actor.user.organizationId;
  if (!organizationId || actor.organizationStatus !== 'active') throw commandError(403, 'FORBIDDEN', '활성 사업자에 소속된 관리자 권한이 필요합니다.');
  const input = jsonBody(body);
  if (operation === 'property.request.create') {
    const requestedOrganization = typeof input.organizationId === 'string' ? input.organizationId.trim() : input.organizationId;
    if (requestedOrganization && requestedOrganization !== organizationId) throw commandError(404, 'NOT_FOUND', '요청 대상을 찾을 수 없습니다.');
    return;
  }
  if (operation === 'user.access.update') {
    if (!target) throw commandError(400, 'INVALID_COMMAND', '사용자를 선택해 주세요.');
    const user = await tx.user.findUnique({ where: { id: target }, select: { organizationId: true, role: true } });
    if (!user || user.organizationId !== organizationId || !['manager', 'cleaner'].includes(normalizeRole(user.role))) throw commandError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
    return;
  }
  if (operation === 'operations.settings.update') {
    const items = Array.isArray(input.properties) ? input.properties : [];
    const ids = items.map(item => jsonBody(item).id).map(id => typeof id === 'string' ? id.trim() : id);
    if (ids.length > 500 || ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 100)) throw commandError(400, 'INVALID_COMMAND', '지점을 확인해 주세요.');
    if (ids.length) {
      const properties = await tx.property.findMany({ where: { id: { in: ids as string[] } }, select: { id: true, organizationId: true } });
      if (properties.length !== new Set(ids).size || properties.some(property => property.organizationId !== organizationId)) throw commandError(404, 'NOT_FOUND', '지점을 찾을 수 없습니다.');
    }
    return;
  }
  throw commandError(403, 'FORBIDDEN', '슈퍼매니저 권한이 필요합니다.');
}

export function createOperationsCommandRunner<Actor extends OperationsCommandActor>(options: {
  transaction: OperationsTransactionRunner;
  refreshActor: (transaction: Prisma.TransactionClient, previous: Actor) => Promise<Actor | null>;
  accessRevision: (transaction: Prisma.TransactionClient, actor: Actor) => Promise<string>;
  encryptionSecret: string;
  now?: () => Date;
  additionalOperations?: readonly string[];
  authorizeAdditional?: (transaction: Prisma.TransactionClient, actor: Actor, operation: string, target: string | null, body: unknown) => Promise<void>;
}) {
  const now = options.now ?? (() => new Date());
  const secret = options.encryptionSecret;
  const encryptionKey = secret && Buffer.byteLength(secret) >= 32
    ? Buffer.from(hkdfSync('sha256', secret, 'void-anchae', 'backend-command-result-v1', 32)) : null;

  async function currentActor(tx: Prisma.TransactionClient, previous: Actor): Promise<Actor> {
    const actor = await options.refreshActor(tx, previous);
    if (!actor || actor.session.userId !== previous.session.userId || actor.user.status !== 'active' ||
        !Number.isFinite(actor.session.expiresAt) || actor.session.expiresAt * 1000 <= now().getTime()) {
      throw commandError(401, 'UNAUTHORIZED', '다시 로그인해 주세요.');
    }
    return actor;
  }

  async function executeCommand<Result>(
    identity: Actor,
    operation: OperationsCommandOperation | (string & {}),
    key: string,
    body: unknown,
    target: string | null,
    execute: (service: OperationsService, currentIdentity: Actor, transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<{ data: Result; commandId: string; replayed: boolean }> {
    if (!encryptionKey) throw commandError(503, 'COMMAND_SECRET_MISSING', '변경 요청 보관 설정이 준비되지 않았습니다.');
    const managementOperation = (operations as readonly string[]).includes(operation);
    if (!managementOperation && (!options.additionalOperations?.includes(operation) || !options.authorizeAdditional)) throw commandError(400, 'INVALID_COMMAND', '지원하지 않는 변경 요청입니다.');
    if (typeof key !== 'string' || !/^[\x21-\x7e]{16,200}$/.test(key)) throw commandError(400, 'IDEMPOTENCY_KEY_REQUIRED', '변경 요청 식별키를 확인해 주세요.');
    if (target !== null && (typeof target !== 'string' || target.length < 1 || target.length > 100)) throw commandError(400, 'INVALID_COMMAND', '요청 대상을 확인해 주세요.');
    const keyHash = createHash('sha256').update(key).digest('hex');
    const requestHash = createHash('sha256').update(canonicalJson({ target, body })).digest('hex');
    const actorId = identity.session.userId;
    const associatedData = (id: string) => Buffer.from(canonicalJson({ id, actorId, operation, keyHash, requestHash }));
    const seal = (id: string, json: string) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      cipher.setAAD(associatedData(id));
      const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
      return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
    };
    const open = (id: string, ciphertext: string): Result => {
      try {
        if (!ciphertext.startsWith('v1.')) throw new Error('Unknown ciphertext version');
        const content = Buffer.from(ciphertext.slice(3), 'base64url');
        if (content.length < 29) throw new Error('Invalid ciphertext');
        const cipher = createDecipheriv('aes-256-gcm', encryptionKey, content.subarray(0, 12));
        cipher.setAAD(associatedData(id));
        cipher.setAuthTag(content.subarray(12, 28));
        return JSON.parse(Buffer.concat([cipher.update(content.subarray(28)), cipher.final()]).toString('utf8')) as Result;
      } catch {
        throw commandError(503, 'COMMAND_RESULT_UNAVAILABLE', '기존 처리 결과를 읽지 못했습니다. 같은 요청을 다시 생성하지 말고 관리자에게 문의해 주세요.');
      }
    };

    try {
      return await options.transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR SHARE`;
        const actor = await currentActor(tx, identity);
        if (managementOperation) await authorizeTarget(tx, actor, operation as OperationsCommandOperation, target, body);
        else await options.authorizeAdditional!(tx, actor, operation, target, body);
        const revision = await options.accessRevision(tx, actor);
        const [record] = await tx.$queryRaw<CommandRecord[]>`SELECT id, request_hash, access_revision, status, result_ciphertext FROM backend_commands WHERE actor_id = ${actorId} AND operation = ${operation} AND key_hash = ${keyHash} FOR UPDATE`;
        if (record) {
          if (record.request_hash !== requestHash) throw commandError(409, 'IDEMPOTENCY_KEY_REUSED', '같은 요청 식별키에 다른 내용을 사용할 수 없습니다.');
          if (record.access_revision !== revision) throw commandError(409, 'ACCESS_CHANGED', '권한이나 관리 범위가 변경되었습니다. 저장된 결과를 관리자에게 확인해 주세요.');
          if (record.status !== 'succeeded' || !record.result_ciphertext) throw commandError(409, 'COMMAND_IN_PROGRESS', '변경 요청이 처리 중입니다. 같은 식별키로 다시 확인해 주세요.', true);
          return { data: open(record.id, record.result_ciphertext), commandId: record.id, replayed: true };
        }
        const id = randomUUID();
        const organizationId = actor.user.organizationId ?? null;
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO backend_commands (id, actor_id, operation, key_hash, request_hash, access_revision, organization_id, target_id, status) VALUES (${id}, ${actorId}, ${operation}, ${keyHash}, ${requestHash}, ${revision}, ${organizationId}, ${target}, 'running') ON CONFLICT (actor_id, operation, key_hash) DO NOTHING RETURNING id`;
        if (!inserted.length) throw commandError(409, 'COMMAND_IN_PROGRESS', '같은 변경 요청이 처리 중입니다. 같은 식별키로 다시 확인해 주세요.', true);
        const service = createOperationsService({ database: tx, transaction: handler => handler(tx) });
        const result = await execute(service, actor, tx);
        const serialized = JSON.stringify(result);
        if (serialized === undefined || Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw commandError(500, 'COMMAND_RESULT_INVALID', '변경 결과를 보관하지 못했습니다.');
        const after = await currentActor(tx, actor);
        const afterRevision = await options.accessRevision(tx, after);
        const ciphertext = seal(id, serialized);
        const completedAt = now();
        const completed = await tx.$executeRaw`UPDATE backend_commands SET status = 'succeeded', result_ciphertext = ${ciphertext}, access_revision = ${afterRevision}, completed_at = ${completedAt} WHERE id = ${id} AND status = 'running'`;
        if (completed !== 1) throw commandError(500, 'COMMAND_RESULT_INVALID', '변경 결과를 보관하지 못했습니다.');
        return { data: JSON.parse(serialized) as Result, commandId: id, replayed: false };
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const dbCode = error && typeof error === 'object' && 'meta' in error ? String((error.meta as { code?: string } | undefined)?.code || '') : '';
      if (['42P01', '42703', 'P2021', 'P2022'].includes(code) || ['42P01', '42703'].includes(dbCode)) throw commandError(503, 'MIGRATION_REQUIRED', '백엔드 변경 요청을 사용하려면 데이터베이스 업데이트가 필요합니다.');
      if (['P2034', '40001', '40P01'].includes(code) || ['40001', '40P01'].includes(dbCode)) throw commandError(409, 'COMMAND_CONFLICT', '다른 요청과 충돌했습니다. 같은 식별키로 다시 확인해 주세요.', true);
      throw error;
    }
  }

  return { executeCommand };
}
