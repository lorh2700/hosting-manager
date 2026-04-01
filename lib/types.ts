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
  description?: string | null;
  basePrice?: number | null;
  createdAt?: string;
}

export interface Channel {
  id: string;
  propertyId: string;
  name: string;
  importUrl: string;
  exportUrl?: string;
  isActive: boolean;
  createdAt?: string;
}

export interface ReservationEvent {
  id: string;
  propertyId: string;
  channelId: string;
  title: string;
  start: string;
  end: string;
  type: 'reservation' | 'block';
  description?: string;
  originalUid?: string;
  createdAt?: string;
}

export interface Booking {
  id: string;
  propertyId: string;
  name: string;
  email: string;
  phone?: string;
  guests: number;
  checkIn: string;
  checkOut: string;
  status: 'confirmed' | 'pending' | 'cancelled';
  message?: string;
  createdAt?: string;
}

export interface CleaningTask {
  id: string;
  propertyId: string;
  date: string;
  cleanerName: string;
  inventoryNote: string;
  completed: boolean;
  bookingName?: string;
}

export interface PropertyData extends Property {
  bookedDates: { start: string; end: string; type: string }[];
}
