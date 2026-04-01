import { v4 as uuidv4 } from 'uuid';

export type ChannelName = string;

export interface Property {
  id: string;
  name: string;
  timezone: string;
}

export interface ChannelConnection {
  id: string;
  propertyId: string;
  name: ChannelName;
  importUrl: string;
  exportUrl: string; // The URL we provide to the OTA
  lastSync?: string;
  isActive: boolean;
}

export interface ReservationEvent {
  id: string;
  propertyId: string;
  channelId: string;
  title: string;
  start: string;
  end: string;
  type: 'reservation' | 'block';
  originalUid?: string; // UID from the original iCal
  description?: string; // Additional details from iCal DESCRIPTION field
}

class MockDB {
  properties: Property[] = [];
  channels: ChannelConnection[] = [];
  events: ReservationEvent[] = [];

  constructor() {
    // Seed data for 운와당
    const prop1Id = uuidv4();
    this.properties.push({
      id: prop1Id,
      name: '운와당',
      timezone: 'Asia/Seoul',
    });

    const prop1AirbnbId = uuidv4();
    const prop1BookingId = uuidv4();
    const prop1StayfolioId = uuidv4();

    this.channels.push(
      {
        id: prop1AirbnbId,
        propertyId: prop1Id,
        name: 'Airbnb',
        importUrl: 'https://www.airbnb.co.kr/calendar/ical/992547788897590426.ics?t=f11aface071641e980dd0294d548e4eb',
        exportUrl: `/api/export/${prop1AirbnbId}.ics`,
        isActive: true,
      },
      {
        id: prop1BookingId,
        propertyId: prop1Id,
        name: 'Booking.com',
        importUrl: 'https://ical.booking.com/v1/export/t/7de8ba5d-d761-475d-bbdf-54a15df0b453.ics',
        exportUrl: `/api/export/${prop1BookingId}.ics`,
        isActive: true,
      },
      {
        id: prop1StayfolioId,
        propertyId: prop1Id,
        name: 'Stayfolio',
        importUrl: '',
        exportUrl: `/api/export/${prop1StayfolioId}.ics`,
        isActive: false,
      }
    );

    // Seed data for 화연재
    const prop2Id = uuidv4();
    this.properties.push({
      id: prop2Id,
      name: '화연재',
      timezone: 'Asia/Seoul',
    });

    const prop2AirbnbId = uuidv4();
    const prop2BookingId = uuidv4();
    const prop2StayfolioId = uuidv4();

    this.channels.push(
      {
        id: prop2AirbnbId,
        propertyId: prop2Id,
        name: 'Airbnb',
        importUrl: 'https://www.airbnb.co.kr/calendar/ical/1368328600307420400.ics?t=05a24937c87945d5b442377911f43aad',
        exportUrl: `/api/export/${prop2AirbnbId}.ics`,
        isActive: true,
      },
      {
        id: prop2BookingId,
        propertyId: prop2Id,
        name: 'Booking.com',
        importUrl: 'https://ical.booking.com/v1/export/t/c5870652-f9a6-4a12-809a-42916c8733a2.ics',
        exportUrl: `/api/export/${prop2BookingId}.ics`,
        isActive: true,
      },
      {
        id: prop2StayfolioId,
        propertyId: prop2Id,
        name: 'Stayfolio',
        importUrl: '',
        exportUrl: `/api/export/${prop2StayfolioId}.ics`,
        isActive: false,
      }
    );
    // Seed data for 안온지점
    const prop3Id = uuidv4();
    this.properties.push({
      id: prop3Id,
      name: '안온',
      timezone: 'Asia/Seoul',
    });

    const prop3AirbnbId = uuidv4();
    const prop3BookingId = uuidv4();
    const prop3StayfolioId = uuidv4();

    this.channels.push(
      {
        id: prop3AirbnbId,
        propertyId: prop3Id,
        name: 'Airbnb',
        importUrl: 'https://www.airbnb.co.kr/calendar/ical/1586139517849528126.ics?t=25bab4d561f1421fb24f71b5504dc5a0',
        exportUrl: `/api/export/${prop3AirbnbId}.ics`,
        isActive: true,
      },
      {
        id: prop3BookingId,
        propertyId: prop3Id,
        name: 'Booking.com',
        importUrl: 'https://ical.booking.com/v1/export/t/10db37aa-0e0a-4952-80e4-ecc4c5a5c394.ics',
        exportUrl: `/api/export/${prop3BookingId}.ics`,
        isActive: true,
      },
      {
        id: prop3StayfolioId,
        propertyId: prop3Id,
        name: 'Stayfolio',
        importUrl: '',
        exportUrl: `/api/export/${prop3StayfolioId}.ics`,
        isActive: false,
      }
    );
  }
}

// Global instance for in-memory persistence across API routes in dev
const globalForDb = globalThis as unknown as {
  db: MockDB | undefined;
};

export const db = globalForDb.db ?? new MockDB();

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
