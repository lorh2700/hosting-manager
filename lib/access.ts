/**
 * 권한·범위 판정을 한곳에 모은다. 라우트는 이 파일의 함수만 쓰고 role 문자열을 직접 비교하지 않는다.
 *
 *  역할 3종
 *   - admin   관리자: 모든 숙소
 *   - manager 매니저: UserProperty 에 배정된 숙소
 *   - cleaner 청소담당자: Cleaner 프로필(userId 연결)이 정체성. 배정 지점(CleanerProperty)이 있으면 그것만,
 *              없으면 소유 호스트의 모든 숙소. 화면 표시·청소 신청·알림 대상이 전부 이 한 규칙이다.
 *
 *  DB 에 남아 있을 수 있는 옛 값(super_admin/host/viewer)은 normalizeRole 이 흡수하므로
 *  마이그레이션 전후 어느 쪽이든 같은 결과가 나온다.
 */
import { prisma } from '@/lib/prisma';
import type { SessionAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

export function normalizeRole(raw: string | null | undefined): UserRole {
  switch (raw) {
    case 'admin':
    case 'super_admin':
      return 'admin';
    case 'cleaner':
      return 'cleaner';
    default:
      // 'manager' 와 옛 값 'host' | 'viewer', 알 수 없는 값은 모두 매니저로 본다 (최소 권한).
      return 'manager';
  }
}

export const isAdminRole = (raw: string | null | undefined): boolean => normalizeRole(raw) === 'admin';

export interface CleanerProfile {
  id: string;
  name: string;
  phone: string | null;
  publicToken: string | null;
  ownerId: string;
  notifyNewOpen: boolean;
}

/** 세션 사용자의 청소담당자 프로필. userId 연결만 인정한다 (전화번호 폴백 없음). */
export async function resolveCleaner(auth: SessionAuth): Promise<CleanerProfile | null> {
  if (auth.role !== 'cleaner') return null;
  return prisma.cleaner.findUnique({
    where: { userId: auth.session.userId },
    select: { id: true, name: true, phone: true, publicToken: true, ownerId: true, notifyNewOpen: true },
  });
}

/** 담당자가 보는 숙소: 배정 지점이 있으면 그것, 없으면 소유 호스트의 모든 숙소. */
export async function cleanerPropertyIds(cleaner: { id: string; ownerId: string }): Promise<string[]> {
  const assigned = await prisma.cleanerProperty.findMany({
    where: { cleanerId: cleaner.id },
    select: { propertyId: true },
  });
  if (assigned.length > 0) return assigned.map(a => a.propertyId);
  const owned = await prisma.property.findMany({ where: { ownerId: cleaner.ownerId }, select: { id: true } });
  return owned.map(p => p.id);
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

  if (auth.role === 'admin') {
    visible = null;
  } else if (auth.role === 'cleaner') {
    const cleaner = await resolveCleaner(auth);
    visible = cleaner ? await cleanerPropertyIds(cleaner) : [];
  } else {
    visible = auth.propertyIds ?? [];
  }

  if (!requested?.length) return visible;
  if (visible === null) return requested;
  return requested.filter(id => visible!.includes(id));
}

/**
 * 쓰기 권한: 관리자이거나, 그 숙소가 배정 숙소(UserProperty)에 포함된 매니저.
 * 청소담당자는 배정 지점이 있어도 예약/숙소 데이터를 수정할 수 없다.
 */
export function canManageProperty(auth: SessionAuth, propertyId: string): boolean {
  if (auth.role === 'admin') return true;
  if (auth.role === 'cleaner') return false;
  return (auth.propertyIds ?? []).includes(propertyId);
}

/** 관리자 또는 숙소 소유자(ownerId)만 — 숙소 삭제처럼 되돌리기 어려운 작업용. */
export async function isPropertyOwnerOrAdmin(auth: SessionAuth, propertyId: string): Promise<boolean> {
  if (auth.role === 'admin') return true;
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } });
  return !!p && p.ownerId === auth.session.userId;
}

/** 청소담당자 프로필의 수정 권한: 관리자 또는 그 프로필을 만든 호스트. */
export function canManageCleaner(auth: SessionAuth, cleaner: { ownerId: string }): boolean {
  return auth.role === 'admin' || cleaner.ownerId === auth.session.userId;
}
