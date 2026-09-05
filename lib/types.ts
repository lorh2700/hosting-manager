// ─── User & Account Management ──────────────────────────────────────────────

/**
 * 역할 3종.
 *  - admin   관리자: 모든 숙소, 유저 관리, 삭제 권한
 *  - manager 매니저: 배정된 숙소(UserProperty)만
 *  - cleaner 청소담당자: Cleaner 프로필이 정체성, 로그인은 선택. 배정 지점(CleanerProperty)만 본다
 * DB 에 남아 있을 수 있는 옛 값(super_admin/host/viewer)은 lib/access.normalizeRole 이 흡수한다.
 */
export type UserRole = 'admin' | 'manager' | 'cleaner';
export type UserStatus = 'active' | 'suspended' | 'pending_invite';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  propertyIds: string[];
  invitedBy?: string;
  status: UserStatus;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  propertyIds: string[];
  invitedBy: string;
  status: 'pending' | 'accepted' | 'expired';
  token: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Property ───────────────────────────────────────────────────────────────

export interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId?: string;
  beds24PropId?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  permit?: string | null;
  imageUrl?: string | null;
  images?: string[];
  region?: string | null;
  description?: string | null;
  basePrice?: number | null;
  maxGuests?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Guest ──────────────────────────────────────────────────────────────────

export interface Guest {
  id: string;
  name: string;
  email: string;
  phone?: string;
  bookingCount: number;
  lastStayAt?: string;
  notes?: string;
  source: 'direct' | 'airbnb' | 'booking' | 'beds24' | 'stayfolio' | 'agoda';
  createdAt: string;
  updatedAt: string;
}

// ─── Booking ────────────────────────────────────────────────────────────────

export type BookingStatus = 'confirmed' | 'pending' | 'cancelled';

export interface Booking {
  id: string;
  propertyId: string;
  guestId?: string;
  channelId?: string;
  channelBookingRef?: string;
  name: string;
  email: string;
  phone?: string;
  guests: number;
  adults?: number;
  children?: number;
  nights?: number;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  message?: string;
  specialRequests?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Integration ───────────────────────────────────────────────────────────

export type IntegrationProvider = 'airbnb' | 'booking' | 'beds24' | 'stayfolio' | 'agoda' | 'naver';
export type IntegrationType = 'ical' | 'api';
export type IntegrationStatus = 'active' | 'inactive' | 'error';

export interface IntegrationConfig {
  importUrl?: string;
  exportUrl?: string;
  apiKey?: string;
  refreshToken?: string;
  propertyRef?: string;
}

export interface Integration {
  id: string;
  propertyId: string;
  provider: IntegrationProvider;
  type: IntegrationType;
  config: IntegrationConfig;
  status: IntegrationStatus;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed';
  lastErrorMessage?: string;
  syncIntervalMinutes: number;
  nextSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Sync Log ───────────────────────────────────────────────────────────────

export type SyncType = 'ical_import' | 'ical_export' | 'beds24_sync' | 'manual';
export type SyncStatus = 'success' | 'partial' | 'failed';

export interface SyncLog {
  id: string;
  propertyId: string;
  channelId: string;
  type: SyncType;
  status: SyncStatus;
  eventsFound: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsRemoved: number;
  errorMessage?: string;
  durationMs: number;
  triggeredBy: string;
  createdAt: string;
}

// ─── Cleaning ───────────────────────────────────────────────────────────────

export interface Cleaner {
  id: string;
  name: string;
  phone?: string;
  ownerId: string;
  /** 신규 오픈 청소 알림톡 수신 여부 */
  notifyNewOpen?: boolean;
  createdAt: string;
}

export interface Cleaning {
  id: string;
  propertyId: string;
  date: string;
  cleanerId?: string;
  status: 'pending' | 'done';
  supplies?: string;
  notes?: string;
  completedAt?: string;
  completionNote?: string;
  reportedBy?: string;
  hasIssue?: boolean;
  isOpen?: boolean;
  assignmentType?: 'direct' | 'applied' | 'external';
  /** 'auto' = 예약 체크아웃에서 자동 생성(예약 취소 시 정리됨), 'manual' = 관리자/패드, 'external' = 파트너 API */
  origin?: 'auto' | 'manual' | 'external';
  createdAt: string;
  updatedAt?: string;
}

// ─── Cleaning Issue ────────────────────────────────────────────────────────

export type IssueCategory = 'damage' | 'malfunction' | 'missing_item' | 'hygiene' | 'other';
export type IssueUrgency = 'low' | 'normal' | 'urgent';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface CleaningIssue {
  id: string;
  cleaningId: string;
  propertyId: string;
  reportedBy: string;
  reportedByName: string;
  category: IssueCategory;
  title: string;
  description: string;
  urgency: IssueUrgency;
  status: IssueStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  resolvedNote?: string;
  createdAt: string;
}

// ─── Supply Request ────────────────────────────────────────────────────────

export interface SupplyItem {
  name: string;
  quantity: number;
  note?: string;
}

export type SupplyRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface SupplyRequest {
  id: string;
  propertyId: string;
  requestedBy: string;
  requestedByName: string;
  items: SupplyItem[];
  urgency: IssueUrgency;
  status: SupplyRequestStatus;
  statusNote?: string;
  processedBy?: string;
  processedAt?: string;
  createdAt: string;
}

// ─── Cleaning Application (일정 신청) ──────────────────────────────────────

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface CleaningApplication {
  id: string;
  cleaningId: string;
  propertyId: string;
  applicantId: string;
  applicantName: string;
  note?: string;
  status: ApplicationStatus;
  rejectedReason?: string;
  processedBy?: string;
  processedAt?: string;
  createdAt: string;
}

// ─── Derived / View Types ───────────────────────────────────────────────────

export interface PropertyData extends Property {
  bookedDates: { start: string; end: string; type: string }[];
  description?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  maxGuests?: number | null;
  region?: string | null;
  slug?: string | null;
  status?: 'active' | 'coming_soon' | 'closed';
  openingDate?: string | null;
  addressKo?: string | null;
  catchphrase?: string | null;
}
