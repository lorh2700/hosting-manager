import { staffDirectory } from '@/lib/staff-directory';
/**
 * 권한·범위 판정을 한곳에 모은다. 라우트는 이 파일의 함수만 쓰고 role 문자열을 직접 비교하지 않는다.
 *
 *  역할 4종
 *   - super_admin 슈퍼매니저: 모든 사업자·숙소
 *   - admin   사업자 관리자: 소속 사업자의 숙소
 *   - manager 매니저: UserProperty 에 배정된 숙소
 *   - cleaner 청소담당자: users의 직원. UserProperty에 배정된 숙소의 청소 업무만 수행한다.
 *
 *  옛 host/viewer 값은 manager로 정규화한다. 사업자 경계는 현재 소속과 배정을 기준으로 한다.
 */
import { prisma } from '@/lib/prisma';
import type { SessionAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

export function normalizeRole(raw: string | null | undefined): UserRole {
  switch (raw) {
    case 'admin':
      return 'admin';
    case 'super_admin':
      return 'super_admin';
    case 'cleaner':
      return 'cleaner';
    default:
      // 'manager' 와 옛 값 'host' | 'viewer', 알 수 없는 값은 모두 매니저로 본다 (최소 권한).
      return 'manager';
  }
}

export const isAdminRole = (raw: string | null | undefined): boolean => ['admin', 'super_admin'].includes(normalizeRole(raw));
export const isSuperAdminRole = (raw: string | null | undefined): boolean => normalizeRole(raw) === 'super_admin';

export interface CleanerProfile {
  id: string;
  name: string;
  phone: string | null;
  publicToken: string | null;
  ownerId: string | null;
  notifyNewOpen: boolean;
}

/** 기존 청소 화면용 직원 DTO. User 자체가 담당자이며 별도 프로필은 없다. */
export async function resolveCleaner(auth: SessionAuth): Promise<CleanerProfile | null> {
  return staffDirectory.findUnique({
    where: { userId: auth.session.userId },
    select: { id: true, name: true, phone: true, publicToken: true, ownerId: true, notifyNewOpen: true },
  });
}

/** Personal cleaning and management use the same user/property identity. */
export async function getCleaningPropertyIds(auth: SessionAuth, requested?: string[] | null): Promise<string[]> {
  if (auth.propertyIds !== null && auth.propertyIds !== undefined) {
    const ids = auth.propertyIds;
    // Old test fixtures resolve cleaner assignments from the staff directory.
    if (auth.role !== 'cleaner' || auth.user.organizationId !== undefined || ids.length) return requested?.length ? ids.filter(id => requested.includes(id)) : ids;
  }
  const cleaner = await resolveCleaner(auth);
  const ids = cleaner ? await cleanerPropertyIds(cleaner) : [];
  return requested?.length ? ids.filter(id => requested.includes(id)) : ids;
}

/** All roles use UserProperty. Admin has all properties; an empty list means none. */
export async function cleanerPropertyIds(person: { id: string; ownerId?: string | null }): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { id: person.id }, select: { role: true, organizationId: true } });
  if (!user) return [];
  if (normalizeRole(user.role) === 'super_admin') return (await prisma.property.findMany({ select: { id: true } })).map(p => p.id);
  if (normalizeRole(user.role) === 'admin') return user.organizationId ? (await prisma.property.findMany({ where: { organizationId: user.organizationId }, select: { id: true } })).map(p => p.id) : [];
  const assignments = await prisma.userProperty.findMany({ where: { userId: person.id }, select: { propertyId: true, property: { select: { organizationId: true } } } });
  return assignments.filter(p => (p.property?.organizationId ?? null) === (user.organizationId ?? null)).map(p => p.propertyId);
}

/**
 * 읽기 범위. null 이면 전체(관리자), 배열이면 그 숙소들만.
 * 요청이 propertyIds 를 지정하면 그 교집합만 돌려준다 — 교집합이 비면 빈 배열.
 */
export async function getVisiblePropertyIds(
  auth: SessionAuth,
  requested?: string[] | null,
): Promise<string[] | null> {
  let visible: string[] | null;

  if (auth.role === 'super_admin') {
    visible = null;
  } else if (auth.role === 'cleaner') {
    const cleaner = await resolveCleaner(auth);
    visible = auth.user.organizationId !== undefined ? auth.propertyIds ?? [] : cleaner ? await cleanerPropertyIds(cleaner) : [];
  } else {
    visible = auth.propertyIds ?? [];
  }

  // getSessionWithUser resolves organization membership and module switches once.
  // Reusing that scope avoids a second property read on every calendar section.
  if (!requested?.length) return visible;
  if (visible === null) return requested;
  return requested.filter(id => visible!.includes(id));
}

/**
 * 쓰기 권한: 관리자이거나, 그 숙소가 배정 숙소(UserProperty)에 포함된 매니저.
 * 청소담당자는 배정 지점이 있어도 예약/숙소 데이터를 수정할 수 없다.
 */
export function canManageProperty(auth: SessionAuth, propertyId: string): boolean {
  if (auth.role === 'super_admin') return true;
  if (auth.role === 'cleaner') return false;
  return (auth.propertyIds ?? []).includes(propertyId);
}

/** 관리자 또는 숙소 소유자(ownerId)만 — 숙소 삭제처럼 되돌리기 어려운 작업용. */
export async function isPropertyOwnerOrAdmin(auth: SessionAuth, propertyId: string): Promise<boolean> {
  if (auth.role === 'super_admin') return true;
  if (!canManageProperty(auth, propertyId)) return false;
  if (auth.role === 'admin') return (auth.propertyIds ?? []).includes(propertyId);
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } });
  return !!p && p.ownerId === auth.session.userId;
}

/** 청소담당자 프로필의 수정 권한: 관리자 또는 그 프로필을 만든 호스트. */
export function canManageCleaner(auth: SessionAuth, cleaner: { ownerId: string | null; organizationId?: string | null; assignments?: Array<{ propertyId: string }> }): boolean {
  if (auth.role === 'super_admin') return true;
  if (auth.role === 'cleaner') return false;
  if ((cleaner.organizationId ?? null) !== (auth.user.organizationId ?? null)) return false;
  if (auth.role === 'admin') return true;
  if (cleaner.assignments?.length) return cleaner.assignments.every(item => (auth.propertyIds ?? []).includes(item.propertyId));
  return cleaner.ownerId === auth.session.userId;
}
