// ─── User & Account Management ──────────────────────────────────────────────

export type UserRole = 'super_admin' | 'admin' | 'host' | 'cleaner' | 'viewer';
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

// ─── Channel (legacy, migrating to Integration) ────────────────────────────

export interface Channel {
  id: string;
  propertyId: string;
  name: string;
  importUrl: string;
  exportUrl?: string;
  isActive: boolean;
  createdAt?: string;
}

// ─── Integration (replaces Channel) ────────────────────────────────────────

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

// ─── Reservation Event ─────────────────────────────────────────────────────

export interface ReservationEvent {
  id: string;
  propertyId: string;
  channelId: string;
  title: string;
  start: string;
  end: string;
  type: 'reservation' | 'block';
  source?: string;
  description?: string;
  originalUid?: string;
  createdAt?: string;
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

export interface CleaningTask {
  id: string;
  propertyId: string;
  date: string;
  cleanerName: string;
  inventoryNote: string;
  completed: boolean;
  bookingName?: string;
}

export interface Cleaner {
  id: string;
  name: string;
  phone?: string;
  ownerId: string;
  createdAt: string;
}

export interface Cleaning {
  id: string;
  propertyId: string;
  date: string;
  cleanerId: string;
  status: 'pending' | 'done';
  supplies?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Derived / View Types ───────────────────────────────────────────────────

export interface PropertyData extends Property {
  bookedDates: { start: string; end: string; type: string }[];
}
