// IMPORTANT: After rotating iCal tokens on Airbnb and Booking.com,
// set the new URLs in .env.local using the variable names below.
export const SEED_PROPERTIES = [
  {
    name: '운와당',
    timezone: 'Asia/Seoul',
    beds24PropId: '319544',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    address: '16-20 Bukchon-ro 11na-gil, Seoul, KR',
    phone: '821094222421',
    email: 'lorh2700@gmail.com',
    permit: '제2024-000026호 (한옥체험업, 서울특별시 종로구)',
    channels: [
      { name: 'Airbnb', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_UNWA_AIRBNB ?? '', isActive: true },
      { name: 'Booking.com', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_UNWA_BOOKING ?? '', isActive: true },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ],
  },
  {
    name: '화연재',
    timezone: 'Asia/Seoul',
    channels: [
      { name: 'Airbnb', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_HWAYEON_AIRBNB ?? '', isActive: true },
      { name: 'Booking.com', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_HWAYEON_BOOKING ?? '', isActive: true },
      { name: 'Agoda', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_HWAYEON_AGODA ?? '', isActive: true },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ],
  },
  {
    name: '안온',
    timezone: 'Asia/Seoul',
    beds24PropId: '319957',
    channels: [
      { name: 'Airbnb', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_ANON_AIRBNB ?? '', isActive: true },
      { name: 'Booking.com', importUrl: process.env.NEXT_PUBLIC_ICAL_URL_ANON_BOOKING ?? '', isActive: true },
      { name: 'Stayfolio', importUrl: '', isActive: false },
    ],
  },
];
