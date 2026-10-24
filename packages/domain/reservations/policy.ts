import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { assertOperationalAccess } from '../../../lib/operational-access';
import { fail } from '../../../lib/core/errors';
import type { BackendIdentity } from '../identity/access';
import { propertyScopeWhere, moduleAllowed } from '../reads/policy';
import { reservationDay } from '../../contracts/reservations';

export function reservationError(status: number, code: string, message: string, retryable = false) {
  return fail(status, message, { code, retryable });
}
export function assertReservationAccess(actor: BackendIdentity) {
  assertOperationalAccess(actor, 'reservations');
  if (!['super_admin', 'admin', 'manager'].includes(actor.role)) throw reservationError(403, 'FORBIDDEN', '예약 관리 권한이 필요합니다.');
}
export function reservationPropertyWhere(actor: BackendIdentity): Prisma.PropertyWhereInput {
  assertReservationAccess(actor);
  return propertyScopeWhere(actor);
}
export function reservationCapabilities(actor: BackendIdentity): string[] {
  return actor.role !== 'cleaner' && moduleAllowed(actor, 'reservations')
    ? ['reservations.read', 'reservations.create', 'reservations.update', 'reservations.cancel', 'reservations.invitation', 'guests.read', 'guests.update', 'guests.review'] : [];
}
export function versionOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}
export function listInput(query: URLSearchParams, now = new Date()) {
  for (const key of ['from', 'to', 'propertyId', 'organizationId', 'q', 'cursor', 'limit', 'status']) if (query.getAll(key).length > 1) throw reservationError(400, 'INVALID_QUERY', '중복된 조회 조건입니다.');
  const day = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const from = query.get('from') || day(-30), to = query.get('to') || day(90);
  if (!reservationDay.safeParse(from).success || !reservationDay.safeParse(to).success || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw reservationError(400, 'INVALID_RANGE', '조회 기간은 최대 1년으로 선택해 주세요.');
  const limit = query.has('limit') ? Number(query.get('limit')) : 25;
  const offset = query.has('cursor') ? Number(query.get('cursor')) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw reservationError(400, 'INVALID_PAGE', '조회 범위를 확인해 주세요.');
  const q = (query.get('q') || '').trim();
  if (q.length > 100) throw reservationError(400, 'INVALID_QUERY', '검색어는 100자 이하로 입력해 주세요.');
  const status = query.get('status') || 'all';
  if (!['all', 'confirmed', 'pending', 'cancelled', 'review'].includes(status)) throw reservationError(400, 'INVALID_QUERY', '조회 상태를 확인해 주세요.');
  return { from, to, limit, offset, q, status, propertyId: query.get('propertyId') || undefined, organizationId: query.get('organizationId') || undefined };
}
