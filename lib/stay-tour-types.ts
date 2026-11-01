export type StayTourLanguage = 'ko' | 'en' | 'zh' | 'ja';

export interface StayTour {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  meetingPoint: string | null;
  durationMin: number | null;
  basePrice: number | null;
  maxGroupSize: number | null;
  images: string[];
  durationOptions: Array<{ id: string; label: string | null; durationMin: number; price: number }>;
  ticketTiers: Array<{ id: string; label: string; price: number; notes: string | null }>;
}

export interface StayTourSelectionInput {
  tourId: string;
  requestedDate: string;
  requestedTime: string;
  guests: number;
  durationOptionId?: string;
  tickets?: Array<{ tierId: string; count: number }>;
  language: StayTourLanguage;
}

export interface StayTourSelectionSnapshot {
  tourId: string;
  title: string;
  slug: string;
  requestedDate: string;
  requestedTime: string;
  guests: number;
  durationOptionId: string | null;
  durationLabel: string | null;
  durationMin: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  tickets: Array<{ tierId: string; label: string; count: number; unitPrice: number }>;
  language: StayTourLanguage;
  requestStatus: 'selected' | 'submitted' | 'unavailable';
  inquiryId: string | null;
}
