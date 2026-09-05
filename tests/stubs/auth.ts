/**
 * '@/lib/auth' 스텁. 기본은 관리자 세션. 테스트에서 authState 를 바꿔 호스트/청소매니저를 흉내낸다.
 * 실제 권한 계산을 검증하려면 '../lib/auth' 를 상대 경로로 직접 import 한다.
 */
export const authState: { auth: any; visible: string[] | null } = {
  auth: null,
  visible: null,
};

export function actAsAdmin() {
  authState.auth = {
    isAdmin: true,
    propertyIds: null,
    user: { id: 'admin-1', email: 'admin@test', role: 'super_admin', status: 'active', phone: null },
    session: { userId: 'admin-1', email: 'admin@test' },
  };
  authState.visible = null;
}

export function actAsHost(propertyIds: string[]) {
  authState.auth = {
    isAdmin: false,
    propertyIds,
    user: { id: 'host-1', email: 'host@test', role: 'host', status: 'active', phone: null },
    session: { userId: 'host-1', email: 'host@test' },
  };
  authState.visible = propertyIds;
}

export function actAsCleaner(visiblePropertyIds: string[]) {
  authState.auth = {
    isAdmin: false,
    propertyIds: [],
    user: { id: 'cleaner-1', email: 'cleaner@test', role: 'cleaner', status: 'active', phone: '01000000000' },
    session: { userId: 'cleaner-1', email: 'cleaner@test' },
  };
  authState.visible = visiblePropertyIds;
}

export function actAsAnonymous() {
  authState.auth = null;
  authState.visible = null;
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

export function canManageProperty(auth: any, propertyId: string): boolean {
  if (auth.isAdmin) return true;
  if (auth.user?.role === 'cleaner') return false;
  return (auth.propertyIds ?? []).includes(propertyId);
}

export async function isPropertyOwnerOrAdmin(auth: any): Promise<boolean> {
  return !!auth.isAdmin;
}

export async function getVisiblePropertyIds(auth: any, requested?: string[] | null): Promise<string[] | null> {
  if (auth.isAdmin) return requested?.length ? requested : null;
  const visible = authState.visible ?? auth.propertyIds ?? [];
  return requested?.length ? requested.filter(id => visible.includes(id)) : visible;
}

export async function authorizeTour() { return null; }
export async function authorizeTourOperator() { return null; }
export async function authorizeTourSchedule() { return null; }
export async function authorizeTourDurationOption() { return null; }
export async function authorizeTourBooking() { return null; }
