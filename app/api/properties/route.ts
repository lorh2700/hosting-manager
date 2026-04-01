import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  return NextResponse.json(db.properties);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, timezone } = body;
  
  const newProperty = {
    id: crypto.randomUUID(),
    name,
    timezone: timezone || 'Asia/Seoul',
  };
  
  db.properties.push(newProperty);
  
  // Create default channels for the property
  const channels = ['Airbnb', 'Booking.com', 'Stayfolio'] as const;
  channels.forEach((channelName) => {
    const channelId = crypto.randomUUID();
    db.channels.push({
      id: channelId,
      propertyId: newProperty.id,
      name: channelName,
      importUrl: '',
      exportUrl: `/api/export/${channelId}.ics`,
      isActive: false,
    });
  });
  
  return NextResponse.json(newProperty, { status: 201 });
}
