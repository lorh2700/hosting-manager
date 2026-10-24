import 'reflect-metadata';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Post, Put, Patch, Req, Res, Module, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { HttpError, fail } from '../../lib/core/errors';
import { assertOperationalAccess } from '../../lib/operational-access';
import type { BackendIdentity } from '../../packages/domain/identity/access';
import type { OperationsService } from '../../packages/domain/operations/service';
import { BACKEND_ROUTES, backendOpenApi, backendBodySchema, type BackendRoute } from '../../packages/contracts/backend-routes';
import type { BackendConfig } from './config';
import express from 'express';

export interface WorkflowRequest {
  identity: BackendIdentity;
  route: BackendRoute;
  targetId: string;
  query: URLSearchParams;
  body: unknown;
  key?: string;
  requestId: string;
  revision: string;
  origin: string;
}

export interface BackendDependencies {
  authenticate(headers: Headers): Promise<BackendIdentity | null>;
  accessRevision(identity: BackendIdentity): Promise<string>;
  read(route: string, identity: BackendIdentity, query: URLSearchParams): Promise<unknown>;
  operations: OperationsService;
  workflow?(input: WorkflowRequest): Promise<unknown>;
  command(input: { identity: BackendIdentity; route: BackendRoute; key: string; targetId: string; body: unknown; requestId: string; revision: string }, execute: (service: OperationsService, actor: BackendIdentity) => Promise<unknown>): Promise<unknown>;
  ready(): Promise<void>;
  close?(): Promise<void>;
  log?(entry: { requestId: string; method: string; route: string; status: number; durationMs: number }): void;
}

interface RequestState { requestId: string; identity?: BackendIdentity; revision?: string }
type StaffRequest = Request & { backend: RequestState };

function sameSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

function meta(requestId: string) { return { requestId, generatedAt: new Date().toISOString() }; }

export function errorEnvelope(error: unknown, requestId: string) {
  const tooLarge = error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large' && 'status' in error && error.status === 413;
  const status = tooLarge ? 413 : error instanceof HttpError ? error.status : error instanceof HttpException ? error.getStatus() : 503;
  const safeStatus = status >= 400 && status <= 599 ? status : 503;
  const details = error instanceof HttpError ? error.extra : undefined;
  const codes: Record<number, string> = { 400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE' };
  const code = typeof details?.code === 'string' ? details.code : codes[safeStatus] || 'REQUEST_FAILED';
  const safeDetails = Object.fromEntries(['migrationRequired', 'currentVersion'].filter(key => details?.[key] !== undefined).map(key => [key, details![key]]));
  return { status: safeStatus, body: { error: { code, message: error instanceof HttpError ? error.message : safeStatus === 404 ? '요청한 기능을 찾을 수 없습니다.' : safeStatus < 500 ? '요청 형식을 확인해 주세요.' : '잠시 후 다시 시도해 주세요.', retryable: typeof details?.retryable === 'boolean' ? details.retryable : safeStatus === 503 || safeStatus === 429, ...(Object.keys(safeDetails).length ? { details: safeDetails } : {}) }, meta: meta(requestId) } };
}

class BackendExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<StaffRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const result = errorEnvelope(error, request.backend?.requestId || randomUUID());
    response.setHeader('Cache-Control', 'private, no-store');
    response.status(result.status).json(result.body);
  }
}

function queryObject(query: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const [key, value] of query) {
    if (key in result) throw fail(400, '중복된 조회 조건입니다.');
    result[key] = value;
  }
  return result;
}

async function managementOperation(service: OperationsService, route: string, identity: BackendIdentity, targetId: string, body: unknown, query: URLSearchParams, origin: string) {
  const q = queryObject(query);
  switch (route) {
    case 'organizations': return { organizations: await service.listOrganizations(identity, { picker: q.picker === '1' }) };
    case 'createOrganization': return { organization: await service.createOrganization(identity, body) };
    case 'updateOrganization': return { organization: await service.updateOrganization(identity, targetId, body) };
    case 'inviteAdministrator': return service.inviteBusinessAdministrator(identity, targetId, body, origin);
    case 'settings': return service.getOperationsSettings(identity, q);
    case 'updateSettings': return service.updateOperationsSettings(identity, body);
    case 'updateUserAccess': return { user: await service.updateUserAccess(identity, targetId, body) };
    case 'propertyRequests': return service.listPropertyRequests(identity, q);
    case 'createPropertyRequest': return { request: await service.createPropertyRequest(identity, body) };
    case 'decidePropertyRequest': return { request: await service.decidePropertyRequest(identity, targetId, body) };
    case 'activity': return service.listActivity(identity, q);
    default: throw fail(404, '요청한 기능을 찾을 수 없습니다.');
  }
}

export async function createBackendApplication(dependencies: BackendDependencies, config: BackendConfig) {
  class StaffController {}
  for (const route of BACKEND_ROUTES) {
    const method = async (req: StaffRequest, res: Response) => {
      const identity = req.backend.identity!;
      assertOperationalAccess(identity, route.module);
      if (route.superOnly && identity.role !== 'super_admin') throw fail(403, '슈퍼매니저 권한이 필요합니다.');
      if (route.businessAdmin && !['super_admin', 'admin'].includes(identity.role)) throw fail(403, '사업자 관리자 권한이 필요합니다.');
      const targetId = String(req.params.id || '');
      if (targetId.length > 100) throw fail(400, '잘못된 대상입니다.');
      const query = new URL(req.originalUrl, config.webOrigin).searchParams;
      const workflow = (key?: string) => {
        if (!dependencies.workflow) throw fail(503, '이 업무 기능을 연결하는 중입니다. 잠시 후 다시 시도해 주세요.');
        return dependencies.workflow({ identity, route, targetId, query, body: req.body, key,
          requestId: req.backend.requestId, revision: req.backend.revision!, origin: config.webOrigin });
      };
      let data: unknown;
      if (route.mutation) {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{16,200}$/.test(key)) throw fail(400, '유효한 Idempotency-Key가 필요합니다.');
        if (!req.is('application/json') || !req.body || Array.isArray(req.body) || typeof req.body !== 'object') throw fail(400, 'JSON 객체를 보내 주세요.');
        if (route.workflow) {
          const result = backendBodySchema(route.id)?.safeParse(req.body);
          if (!result?.success) throw fail(400, result?.error.issues[0]?.message || '입력값을 확인해 주세요.');
        }
        data = route.workflow ? await workflow(key) : await dependencies.command({ identity, route, key, targetId, body: req.body, requestId: req.backend.requestId, revision: req.backend.revision! }, (service, actor) => managementOperation(service, route.id, actor, targetId, req.body, query, config.webOrigin));
      } else if (route.workflow) {
        data = await workflow();
      } else if (['bootstrap', 'properties', 'staff', 'today', 'calendar', 'cleanerCalendar'].includes(route.id)) {
        data = await dependencies.read(route.id, identity, query);
      } else {
        data = await managementOperation(dependencies.operations, route.id, identity, targetId, undefined, query, config.webOrigin);
      }
      res.status(route.status || 200).json({ data, meta: meta(req.backend.requestId) });
    };
    Object.defineProperty(StaffController.prototype, route.id, { value: method, configurable: true });
    const descriptor = Object.getOwnPropertyDescriptor(StaffController.prototype, route.id)!;
    ({ GET: Get, POST: Post, PUT: Put, PATCH: Patch }[route.method])(route.path)(StaffController.prototype, route.id, descriptor);
    Req()(StaffController.prototype, route.id, 0);
    Res()(StaffController.prototype, route.id, 1);
  }
  Controller('api/app/v1')(StaffController);

  class HealthController {
    live() { return { status: 'ok' }; }
    async ready() { await dependencies.ready(); return { status: 'ready' }; }
    schema() { return backendOpenApi(); }
  }
  Controller()(HealthController);
  for (const [method, path] of [['live', 'health/live'], ['ready', 'health/ready'], ['schema', 'openapi.json']] as const) {
    Get(path)(HealthController.prototype, method, Object.getOwnPropertyDescriptor(HealthController.prototype, method)!);
  }
  class BackendModule {}
  Module({ controllers: [StaffController, HealthController] })(BackendModule);
  const app = await NestFactory.create<NestExpressApplication>(BackendModule, { logger: false, abortOnError: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useGlobalFilters(new BackendExceptionFilter());
  app.use(async (req: StaffRequest, res: Response, next: NextFunction) => {
    const started = performance.now();
    const requestId = randomUUID();
    req.backend = { requestId };
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.once('finish', () => dependencies.log?.({ requestId, method: req.method, route: req.route?.path || 'unmatched', status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    try {
      if (req.path === '/health/live' && req.method === 'GET') return next();
      if (!sameSecret(req.headers['x-backend-key'], config.bridgeSecret)) throw fail(401, '서버 연결 인증이 필요합니다.');
      if (['/health/ready', '/openapi.json'].includes(req.path) && req.method === 'GET') return next();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.webOrigin) throw fail(403, '허용되지 않은 요청 출처입니다.');
      const headers = new Headers();
      if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
      const identity = await dependencies.authenticate(headers);
      if (!identity) throw fail(401, '로그인이 필요합니다.');
      req.backend.identity = identity;
      req.backend.revision = await dependencies.accessRevision(identity);
      res.setHeader('X-Access-Revision', req.backend.revision);
      assertOperationalAccess(identity, null);
      next();
    } catch (error) {
      const result = errorEnvelope(error, requestId);
      res.status(result.status).json(result.body);
    }
  });
  const imageParser = express.json({ limit: '3mb', strict: true });
  const jsonParser = express.json({ limit: '64kb', strict: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const imageUpload = req.method === 'POST' && req.path === '/api/app/v1/jongno-events/images';
    return (imageUpload ? imageParser : jsonParser)(req, res, next);
  });
  await app.init();
  return app;
}
