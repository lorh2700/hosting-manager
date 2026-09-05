/**
 * '@/lib/auth' 스텁. 기본은 관리자 세션. 테스트에서 actAs* 로 매니저/청소담당자를 흉내낸다.
 * 권한·범위 판정(lib/access)은 스텁하지 않고 실제 로직이 인메모리 prisma 위에서 돈다 —
 * 그래서 actAsCleaner 는 Cleaner 프로필과 배정 지점을 db 에 심는다.
 */
import { db } from './prisma';

export const authState: { auth: any } = { auth: null };

export function actAsAdmin() {
  authState.auth = {
    role: 'admin',
    isAdmin: true,
    propertyIds: null,
    user: { id: 'admin-1', email: 'admin@test', role: 'admin', status: 'active', phone: null },
    session: { userId: 'admin-1', email: 'admin@test' },
  };
}

/** 매니저: UserProperty 배정 숙소만. (예전 이름 actAsHost 도 그대로 쓴다) */
export function actAsManager(propertyIds: string[]) {
  authState.auth = {
    role: 'manager',
    isAdmin: false,
    propertyIds,
    user: { id: 'host-1', email: 'host@test', role: 'manager', status: 'active', phone: null },
    session: { userId: 'host-1', email: 'host@test' },
  };
}
export const actAsHost = actAsManager;

/**
 * 청소담당자. host-1 소유의 프로필 cl-1 을 심고, assignedPropertyIds 가 있으면 배정 지점으로 넣는다.
 * 비어 있으면 "배정 없음 = 호스트의 모든 숙소" 규칙이 적용된다.
 */
export function actAsCleaner(assignedPropertyIds: string[] = [], opts: { withProfile?: boolean } = {}) {
  authState.auth = {
    role: 'cleaner',
    isAdmin: false,
    propertyIds: [],
    user: { id: 'cleaner-1', email: 'cleaner@test', role: 'cleaner', status: 'active', phone: '01000000000' },
    session: { userId: 'cleaner-1', email: 'cleaner@test' },
  };
  db.cleaner ??= [];
  if (opts.withProfile === false) {
    db.cleaner = db.cleaner.filter(c => c.id !== 'cl-1');
    return;
  }
  if (!db.cleaner.some(c => c.id === 'cl-1')) {
    db.cleaner.push({ id: 'cl-1', name: '청소', phone: '01000000000', publicToken: 'tok-1', userId: 'cleaner-1', ownerId: 'host-1', notifyNewOpen: true });
  }
  db.cleanerProperty = (db.cleanerProperty ?? []).filter(a => a.cleanerId !== 'cl-1');
  for (const pid of assignedPropertyIds) db.cleanerProperty.push({ cleanerId: 'cl-1', propertyId: pid });
}

export function actAsAnonymous() {
  authState.auth = null;
}

actAsAdmin();

export type SessionAuth = any;

export async function getSessionWithUser() { return authState.auth; }
export async function verifySession() { return authState.auth ? authState.auth.session : null; }
export async function getSession() { return authState.auth ? { user: authState.auth.user, profile: {} } : null; }
export async function verifyToken() { return authState.auth?.session ?? null; }
export async function signToken() { return 'token'; }
export async function setSessionCookie() {}
export async function clearSessionCookie() {}

export async function authorizeTour() { return null; }
export async function authorizeTourOperator() { return null; }
export async function authorizeTourSchedule() { return null; }
export async function authorizeTourDurationOption() { return null; }
export async function authorizeTourBooking() { return null; }
