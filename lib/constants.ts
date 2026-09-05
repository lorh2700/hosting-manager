import type { UserRole, UserStatus, IssueCategory, IssueUrgency, IssueStatus, SupplyRequestStatus } from './types';

// ─── 역할 ────────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  manager: '매니저',
  cleaner: '청소담당자',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: '모든 숙소와 설정, 유저 관리까지 접근합니다.',
  manager: '배정된 숙소의 예약·청소·메시지만 관리합니다.',
  cleaner: '청소 담당자 관리 화면에서 프로필과 함께 관리합니다.',
};

/** 유저 관리 화면에서 초대·역할 변경이 가능한 역할 (청소담당자는 청소 담당자 화면에서) */
export const STAFF_ROLES: UserRole[] = ['admin', 'manager'];

export const ADMIN_ROLES: UserRole[] = ['admin'];

// ─── 사용자 상태 ─────────────────────────────────────────────────────────────

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: '활성',
  suspended: '비활성',
  pending_invite: '승인 대기',
};

// ─── 이슈 카테고리 ──────────────────────────────────────────────────────────

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  damage: '파손',
  malfunction: '고장',
  missing_item: '분실/부족',
  hygiene: '위생',
  other: '기타',
};

// ─── 긴급도 ──────────────────────────────────────────────────────────────────

export const URGENCY_LABELS: Record<IssueUrgency, { label: string; color: string }> = {
  low: { label: '낮음', color: 'text-white/40' },
  normal: { label: '보통', color: 'text-amber-400' },
  urgent: { label: '긴급', color: 'text-red-400' },
};

// ─── 이슈 상태 ──────────────────────────────────────────────────────────────

export const ISSUE_STATUS_CONFIG: Record<IssueStatus, { label: string; color: string; bg: string }> = {
  open: { label: '접수', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  in_progress: { label: '처리중', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  resolved: { label: '해결', color: 'text-green-400', bg: 'bg-green-500/20' },
  closed: { label: '종료', color: 'text-white/30', bg: 'bg-white/5' },
};

// ─── 비품 요청 상태 ──────────────────────────────────────────────────────────

export const SUPPLY_STATUS_CONFIG: Record<SupplyRequestStatus, { label: string; color: string; bg: string }> = {
  pending: { label: '대기', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  approved: { label: '승인', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  rejected: { label: '거절', color: 'text-red-400', bg: 'bg-red-500/20' },
  completed: { label: '완료', color: 'text-green-400', bg: 'bg-green-500/20' },
};

// ─── 이슈 상태 전이 ────────────────────────────────────────────────────────

export const ISSUE_NEXT_STATUS: Partial<Record<IssueStatus, IssueStatus>> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'closed',
};
