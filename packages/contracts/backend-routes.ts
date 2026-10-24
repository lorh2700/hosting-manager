import type { OperationalModule } from '../../lib/operational-permissions';
import { z } from 'zod';
import { operationsBodySchemas } from './operations';
import { reservationRoutes, reservationBodySchemas } from './reservations';
import { FIELD_ROUTES, fieldBodySchemas } from './field-operations';
import { PEOPLE_EVENT_ROUTES, peopleEventBodySchemas } from './people-events';

export interface BackendRoute {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  module: OperationalModule | null;
  businessAdmin?: boolean;
  superOnly?: boolean;
  mutation?: boolean;
  status?: number;
  workflow?: boolean;
  summary: string;
}

export const BACKEND_ROUTES: readonly BackendRoute[] = [
  { id: 'bootstrap', method: 'GET', path: 'bootstrap', module: null, summary: '현재 계정과 사용 가능한 기능' },
  { id: 'properties', method: 'GET', path: 'properties', module: null, summary: '권한 내 숙소 요약' },
  { id: 'staff', method: 'GET', path: 'staff', module: 'staff', workflow: true, summary: '사업자·담당 숙소 범위 직원 목록' },
  { id: 'today', method: 'GET', path: 'operations/today', module: null, summary: '입퇴실·청소 당일 조회' },
  { id: 'calendar', method: 'GET', path: 'calendar', module: 'reservations', summary: '예약·청소 월간 조회' },
  { id: 'cleanerCalendar', method: 'GET', path: 'cleaner/calendar', module: 'cleaning', summary: '청소 담당자 일정 조회' },
  { id: 'organizations', method: 'GET', path: 'organizations', module: null, businessAdmin: true, summary: '사업자 목록' },
  { id: 'createOrganization', method: 'POST', path: 'organizations', module: null, superOnly: true, mutation: true, status: 201, summary: '사업자 등록' },
  { id: 'updateOrganization', method: 'PATCH', path: 'organizations/:id', module: null, superOnly: true, mutation: true, summary: '사업자·숙소 소속 변경' },
  { id: 'inviteAdministrator', method: 'POST', path: 'organizations/:id/invitations', module: null, superOnly: true, mutation: true, status: 201, summary: '사업자 관리자 초대 링크 발급' },
  { id: 'settings', method: 'GET', path: 'settings', module: null, businessAdmin: true, summary: '사업자·숙소 옵션과 사용자 권한' },
  { id: 'updateSettings', method: 'PUT', path: 'settings', module: null, businessAdmin: true, mutation: true, summary: '사업자·숙소 옵션 저장' },
  { id: 'updateUserAccess', method: 'PATCH', path: 'users/:id/access', module: 'staff', businessAdmin: true, mutation: true, summary: '사용자 역할·메뉴·숙소 배정 변경' },
  { id: 'propertyRequests', method: 'GET', path: 'property-requests', module: null, businessAdmin: true, summary: '지점 추가 요청 목록' },
  { id: 'createPropertyRequest', method: 'POST', path: 'property-requests', module: null, businessAdmin: true, mutation: true, status: 201, summary: '지점 추가 신청' },
  { id: 'decidePropertyRequest', method: 'PATCH', path: 'property-requests/:id', module: null, superOnly: true, mutation: true, summary: '지점 추가 승인·반려' },
  { id: 'activity', method: 'GET', path: 'activity', module: null, businessAdmin: true, summary: '사업자 범위 활동 기록' },
  ...reservationRoutes.map(route => ({ ...route, workflow: true })),
  ...FIELD_ROUTES.map(route => ({ ...route, workflow: true })),
  ...PEOPLE_EVENT_ROUTES.map(route => ({ ...route, workflow: true })),
];

const bodySchemas: Record<string, z.ZodType> = { ...operationsBodySchemas, ...reservationBodySchemas, ...fieldBodySchemas, ...peopleEventBodySchemas };
export function backendBodySchema(routeId: string) { return bodySchemas[routeId]; }

export function backendOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of BACKEND_ROUTES) {
    const path = `/api/app/v1/${route.path.replace(/:([a-z]+)/g, '{$1}')}`;
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      operationId: route.id, summary: route.summary,
      security: [{ BridgeKey: [], StaffCookie: [] }],
      parameters: [
        ...(route.path.includes(':id') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 100 } }] : []),
        ...(route.mutation ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 16, maxLength: 200 } }] : []),
      ],
      ...(route.mutation ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(bodySchemas[route.id], { io: 'input' }) } } } } : {}),
      responses: Object.fromEntries([route.status ?? 200, 400, 401, 403, 404, 409, 503].map(status => [String(status), {
        description: status < 400 ? 'Success envelope: data and meta' : 'Error envelope: error and meta',
        content: { 'application/json': { schema: { $ref: status < 400 ? '#/components/schemas/Success' : '#/components/schemas/Error' } } },
      }])),
    };
  }
  return { openapi: '3.1.0', info: { title: 'Hosting Manager staff API', version: '1.0.0', description: 'Private migration API. Requires the server bridge key and an existing staff cookie. Native access/refresh sessions are not available yet.' }, paths,
    components: { securitySchemes: { BridgeKey: { type: 'apiKey', in: 'header', name: 'x-backend-key' }, StaffCookie: { type: 'apiKey', in: 'cookie', name: 'va_session' } },
      schemas: {
        Success: { type: 'object', required: ['data', 'meta'], properties: { data: {}, meta: { $ref: '#/components/schemas/Meta' } } },
        Error: { type: 'object', required: ['error', 'meta'], properties: { error: { type: 'object', required: ['code', 'message', 'retryable'], properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, details: { type: 'object' } } }, meta: { $ref: '#/components/schemas/Meta' } } },
        Meta: { type: 'object', required: ['requestId', 'generatedAt'], properties: { requestId: { type: 'string' }, generatedAt: { type: 'string', format: 'date-time' } } },
      },
    },
  };
}
