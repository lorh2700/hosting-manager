import type { AdminMode } from './adminMode';
import type { UserRole } from './types';
import { canUseModule, isModuleEnabled, moduleForAdminPath } from './operational-permissions';

export type AdminNavIcon = 'home' | 'calendar' | 'bookings' | 'messages' | 'cleaning' | 'laundry' | 'issues' | 'supplies' | 'report' | 'payments' | 'properties' | 'staff' | 'guests' | 'pickup' | 'integrations' | 'api' | 'account' | 'tours' | 'tour-bookings' | 'tour-operators' | 'my-cleaning' | 'settings' | 'activity';

export interface AdminNavItem {
  href: string;
  label: string;
  mobileLabel?: string;
  icon: AdminNavIcon;
  roles: readonly UserRole[];
}

export interface AdminNavGroup {
  id: string;
  label: string;
  alwaysOpen?: boolean;
  items: AdminNavItem[];
}

const MANAGERS: readonly UserRole[] = ['super_admin', 'admin', 'manager'];
const ACCOUNT: AdminNavItem = { href: '/admin/settings/profile', label: '내 계정', icon: 'account', roles: ['super_admin', 'admin', 'manager', 'cleaner'] };
const API: AdminNavItem = { href: '/admin/api-clients', label: 'API 클라이언트', icon: 'api', roles: ['super_admin'] };
const SETTINGS: AdminNavItem = { href: '/admin/settings', label: '사업자·사용자·운영 설정', mobileLabel: '운영 설정', icon: 'settings', roles: ['super_admin', 'admin'] };
const ACTIVITY: AdminNavItem = { href: '/admin/activity', label: '활동 로그', icon: 'activity', roles: ['super_admin', 'admin'] };
const TODAY: AdminNavItem = { href: '/admin', label: '오늘', icon: 'home', roles: MANAGERS };
const MY_CLEANING: AdminNavItem = { href: '/cleaner', label: '내 청소 업무', icon: 'my-cleaning', roles: MANAGERS };
const JONGNO_EVENTS: AdminNavItem = { href: '/admin/jongno-events', label: '종로 행사 캘린더', icon: 'calendar', roles: ['super_admin'] };

const HOST_GROUPS: AdminNavGroup[] = [
  { id: 'daily', label: '매일 업무', alwaysOpen: true, items: [
    TODAY,
    { href: '/admin/calendar', label: '예약 달력', mobileLabel: '캘린더', icon: 'calendar', roles: MANAGERS },
    { href: '/admin/bookings', label: '예약 관리', icon: 'bookings', roles: MANAGERS },
    { href: '/admin/messages', label: '메시지', icon: 'messages', roles: MANAGERS },
    { href: '/admin/guest-stays', label: '게스트 웹앱·신청함', mobileLabel: '게스트 웹앱', icon: 'guests', roles: MANAGERS },
  ] },
  { id: 'maintenance', label: '객실 정비', items: [
    { href: '/admin/inventory', label: '재고·세탁 기록', icon: 'supplies', roles: MANAGERS },
    { href: '/admin/laundry', label: '세탁 관리', icon: 'laundry', roles: MANAGERS },
    { href: '/admin/issues', label: '이슈 관리', icon: 'issues', roles: MANAGERS },
    { href: '/admin/supplies', label: '비품 요청', icon: 'supplies', roles: MANAGERS },
  ] },
  { id: 'settlement', label: '정산', items: [
    { href: '/admin/cleaning-report', label: '청소 정산 내역', icon: 'report', roles: MANAGERS },
    { href: '/admin/payments', label: '결제·환불', icon: 'payments', roles: MANAGERS },
  ] },
  { id: 'operations', label: '운영 관리', items: [
    { href: '/admin/properties', label: '숙소 관리', icon: 'properties', roles: MANAGERS },
    { href: '/admin/staff', label: '직원 관리', icon: 'staff', roles: MANAGERS },
    { href: '/admin/guests', label: '고객 명부', icon: 'guests', roles: ['super_admin'] },
    { href: '/admin/guest-services', label: '픽업 요청', icon: 'pickup', roles: MANAGERS },
    JONGNO_EVENTS,
  ] },
  { id: 'settings', label: '설정', items: [
    { href: '/admin/integrations', label: '연동 관리', icon: 'integrations', roles: MANAGERS },
    SETTINGS,
    ACTIVITY,
    API,
    ACCOUNT,
  ] },
];

const TOUR_GROUPS: AdminNavGroup[] = [
  { id: 'daily', label: '매일 업무', alwaysOpen: true, items: [
    TODAY,
    { href: '/admin/tour-bookings', label: '투어 예약', icon: 'tour-bookings', roles: MANAGERS },
    { href: '/admin/tours', label: '투어 상품', icon: 'tours', roles: MANAGERS },
  ] },
  { id: 'operations', label: '운영 관리', items: [
    { href: '/admin/tour-operators', label: '운영업체', icon: 'tour-operators', roles: MANAGERS },
    JONGNO_EVENTS,
  ] },
  { id: 'settings', label: '설정', items: [SETTINGS, ACTIVITY, API, ACCOUNT] },
];

/** Menu visibility follows the existing account role; route APIs still enforce access. */
export function getAdminNavigation(mode: AdminMode, role: UserRole, access: { enabledModules?: unknown; organizationFeatures?: unknown } = {}) {
  const permitted = (item: AdminNavItem) => {
    if (!item.roles.includes(role)) return false;
    const operationalModule = item.href === '/admin' && mode === 'tour' ? 'tours' : moduleForAdminPath(item.href);
    return !operationalModule || role === 'super_admin' || (canUseModule(role, access.enabledModules, operationalModule) && isModuleEnabled(operationalModule, access.organizationFeatures));
  };
  const groups = (mode === 'tour' ? TOUR_GROUPS : HOST_GROUPS)
    .map(group => ({ ...group, items: group.items.filter(permitted) }))
    .filter(group => group.items.length > 0);
  const primaryPaths = mode === 'tour'
    ? ['/admin', '/admin/tour-bookings', '/admin/tours']
    : ['/admin', '/admin/calendar', '/admin/messages'];
  const items = groups.flatMap(group => group.items);
  const primary = primaryPaths.map(href => items.find(item => item.href === href)).filter((item): item is AdminNavItem => Boolean(item));
  const secondary = permitted(MY_CLEANING) ? [MY_CLEANING] : [];
  return { groups, primary, secondary };
}

export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin' || pathname === '/admin/ops';
  if (href === '/admin/settings') return pathname === href || (pathname.startsWith(href + '/') && !pathname.startsWith('/admin/settings/profile'));
  return pathname === href || pathname.startsWith(href + '/');
}
