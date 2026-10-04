import type { UserRole } from './types';

/** The same catalog drives user grants, business options, navigation and APIs. */
export const OPERATIONAL_MODULES = [
  { key: 'reservations', label: '예약·캘린더', description: '예약과 입퇴실 일정 관리', cleanerAllowed: false },
  { key: 'messages', label: '고객 메시지', description: '고객 대화와 자동응답 관리', cleanerAllowed: false },
  { key: 'cleaning', label: '청소', description: '청소 일정·신청·완료 보고', cleanerAllowed: true },
  { key: 'inventory', label: '재고', description: '깨끗한 린넨과 비품 재고 기록', cleanerAllowed: true },
  { key: 'laundry', label: '세탁', description: '세탁물 발송·입고 기록', cleanerAllowed: true },
  { key: 'issues', label: '이슈', description: '숙소 문제 신고와 처리', cleanerAllowed: true },
  { key: 'supplies', label: '비품 요청', description: '필요한 비품 요청과 처리', cleanerAllowed: true },
  { key: 'settlement', label: '청소 정산', description: '담당자별 청소 정산', cleanerAllowed: false },
  { key: 'payments', label: '결제', description: '예약 결제와 환불 관리', cleanerAllowed: false },
  { key: 'staff', label: '직원', description: '담당 직원과 청소 인력 관리', cleanerAllowed: false },
  { key: 'properties', label: '숙소', description: '배정 숙소 운영 정보 관리', cleanerAllowed: false },
  { key: 'integrations', label: '채널 연동', description: 'Beds24 등 외부 채널 연결', cleanerAllowed: false },
  { key: 'priceLabs', label: 'PriceLabs', description: 'PriceLabs 가격 연동 옵션', cleanerAllowed: false },
  { key: 'guestServices', label: '게스트 서비스', description: '객실 QR·웰컴패드·게스트 요청', cleanerAllowed: false },
  { key: 'tours', label: '투어', description: '투어 프로그램과 신청 관리', cleanerAllowed: false },
] as const;

export type OperationalModule = typeof OPERATIONAL_MODULES[number]['key'];
export type FeatureSwitches = Partial<Record<OperationalModule, boolean>>;
const keys = new Set<string>(OPERATIONAL_MODULES.map(item => item.key));
export const isOperationalModule = (value: unknown): value is OperationalModule => typeof value === 'string' && keys.has(value);

export function defaultModulesForRole(role: UserRole | string): OperationalModule[] {
  return OPERATIONAL_MODULES.filter(item => role !== 'cleaner' || item.cleanerAllowed).map(item => item.key);
}

/** null preserves existing accounts; an explicit empty array grants no optional menus. */
export function normalizeModuleGrants(value: unknown, role: UserRole | string): OperationalModule[] {
  const allowed = new Set(defaultModulesForRole(role));
  if (value === null || value === undefined) return [...allowed];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isOperationalModule))].filter(key => allowed.has(key));
}

export function canUseModule(role: UserRole | string, grants: unknown, module: OperationalModule): boolean {
  if (role === 'super_admin' || role === 'admin') return true;
  return normalizeModuleGrants(grants, role).includes(module);
}

export function normalizeFeatureSwitches(value: unknown): FeatureSwitches {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, enabled]) => isOperationalModule(key) && typeof enabled === 'boolean')) as FeatureSwitches;
}

/** A property may disable an option, but cannot re-enable a business option disabled by the supervisor. */
export function isModuleEnabled(module: OperationalModule, organizationFeatures?: unknown, propertyOverrides?: unknown): boolean {
  return normalizeFeatureSwitches(organizationFeatures)[module] !== false && normalizeFeatureSwitches(propertyOverrides)[module] !== false;
}

export function moduleForApiPath(rawPath: string, method = 'GET'): OperationalModule | null {
  const path = rawPath.split('?')[0].replace(/\/$/, '');
  if (/^\/api\/(public|v1|auth|health|debug|holidays)(\/|$)/.test(path)) return null;
  if (/^\/api\/(admin\/)?(organizations|operations-settings|user-access|activity|property-requests)(\/|$)/.test(path)) return null;
  if (/^\/api\/properties\/[^/]+\/(inquiry-automation|inquiry-notifications)/.test(path)) return 'messages';
  if (/^\/api\/properties\/[^/]+\/channels/.test(path)) return 'integrations';
  if (path === '/api/uploads/property-image') return 'properties';
  if (/^\/api\/(cleaners\/me|cleaner\/today|cleanings|cleaning-applications)(\/|$)/.test(path)) return 'cleaning';
  if (/^\/api\/(cleaning-issues)(\/|$)/.test(path)) return 'issues';
  if (/^\/api\/(supply-requests|supply-todos|admin\/calendar\/supply-todos)(\/|$)/.test(path)) return 'supplies';
  if (/^\/api\/laundry(\/|$)/.test(path)) return 'laundry';
  if (/^\/api\/inventory(\/|$)/.test(path)) return 'inventory';
  if (/^\/api\/(settlement|settlements)(\/|$)/.test(path)) return 'settlement';
  if (/^\/api\/(users|staff|cleaners|invitations)(\/|$)/.test(path)) return 'staff';
  if (/^\/api\/(messages|conversations|inquiry-automation|beds24\/messages)(\/|$)/.test(path)) return 'messages';
  if (/^\/api\/(tours|tour-|uploads\/tour-image)/.test(path)) return 'tours';
  if (/^\/api\/(guest-stays|guest-invitations|guest-services|welcomepad-chat)(\/|$)/.test(path)) return 'guestServices';
  if (path === '/api/checkout/confirm') return 'reservations';
  if (/^\/api\/(payments|admin\/payments|checkout)(\/|$)/.test(path)) return 'payments';
  if (/^\/api\/(integrations|sync|export|beds24\/sync|admin\/api-clients)(\/|$)/.test(path)) return 'integrations';
  if (/^\/api\/(bookings|events|guests|admin\/bookings|admin\/calendar|ops\/today|dashboard|beds24\/(bookings|reservations|maintenance))(\/|$)/.test(path)) return 'reservations';
  if (/^\/api\/(camera|cron\/camera-inbox)(\/|$)/.test(path)) return 'guestServices';
  // Basic property names are needed by every assigned operational menu.
  if (path === '/api/properties' && method === 'GET') return null;
  if (/^\/api\/properties(\/|$)/.test(path)) return 'properties';
  return null;
}

export function moduleForAdminPath(rawPath: string): OperationalModule | null {
  const path = rawPath.split('?')[0].replace(/\/$/, '');
  if (path === '/cleaner') return 'cleaning';
  if (/^\/admin\/cleaning-report(\/|$)/.test(path)) return 'settlement';
  if (/^\/(admin|cleaner)\/(cleanings|cleaning|cleaning-requests|schedule|applications)(\/|$)/.test(path) || /^\/cleaner\/(calendar|history)(\/|$)/.test(path)) return 'cleaning';
  if (/^\/admin\/(users|staff|cleaners|invitations)(\/|$)/.test(path)) return 'staff';
  if (/^\/admin\/(inventory)(\/|$)/.test(path)) return 'inventory';
  if (/^\/admin\/laundry(\/|$)/.test(path)) return 'laundry';
  if (/^\/(admin|cleaner)\/(issues|cleaning-issues)(\/|$)/.test(path)) return 'issues';
  if (/^\/(admin|cleaner)\/(supplies|supply-requests|supply-todos)(\/|$)/.test(path)) return 'supplies';
  if (/^\/admin\/(settlement|settlements)(\/|$)/.test(path)) return 'settlement';
  if (/^\/admin\/(payments)(\/|$)/.test(path)) return 'payments';
  if (/^\/admin\/(integrations)(\/|$)/.test(path)) return 'integrations';
  if (/^\/admin\/properties(\/|$)/.test(path)) return 'properties';
  if (/^\/admin\/(messages|inquiries)(\/|$)/.test(path)) return 'messages';
  if (/^\/admin\/(guest-stays|guest-services|welcomepad)(\/|$)/.test(path)) return 'guestServices';
  if (/^\/(admin\/)?tour/.test(path)) return 'tours';
  if (/^\/admin\/(calendar|bookings|guests|today)(\/|$)/.test(path) || path === '/admin') return 'reservations';
  return null;
}

export function mayUseOperationalPath(profile: { role: UserRole; enabledModules?: unknown; organizationFeatures?: unknown }, path: string): boolean {
  if (path.startsWith('/admin/settings/profile')) return true;
  if (/^\/admin\/(settings|activity|organizations|users)(\/|$)/.test(path)) return ['super_admin', 'admin'].includes(profile.role);
  if (path.startsWith('/cleaner/records')) return (['inventory', 'laundry', 'supplies'] as const).some(module => canUseModule(profile.role, profile.enabledModules, module) && (profile.role === 'super_admin' || isModuleEnabled(module, profile.organizationFeatures)));
  const operationalModule = moduleForAdminPath(path);
  return !operationalModule || profile.role === 'super_admin' || (canUseModule(profile.role, profile.enabledModules, operationalModule) && isModuleEnabled(operationalModule, profile.organizationFeatures));
}
