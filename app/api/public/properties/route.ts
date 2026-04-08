import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function GET() {
  try {
    const db = getAdminDb();
    const snap = await db.collection('properties').orderBy('createdAt', 'desc').get();
    const properties = snap.docs.map(d => ({
      id: d.id,
      name: d.data().name,
      timezone: d.data().timezone,
    }));
    return NextResponse.json(properties);
  } catch (error) {
    console.error('Failed to fetch properties:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
