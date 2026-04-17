import { NextResponse } from 'next/server';
import { syncBeds24Property } from '@/lib/sync-engine';

export async function POST(req: Request) {
  const body = await req.json();
  const { propertyId, beds24PropId } = body;

  if (!propertyId || !beds24PropId) {
    return NextResponse.json({ error: 'propertyId and beds24PropId are required' }, { status: 400 });
  }

  try {
    const result = await syncBeds24Property(propertyId, beds24PropId);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      total: result.total,
      eventsCreated: result.eventsCreated,
      eventsUpdated: result.eventsUpdated,
      eventsRemoved: result.eventsRemoved,
    });
  } catch (error) {
    console.error('Beds24 sync error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
