import { NextResponse } from 'next/server';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function GET() {
  try {
    const snap = await getDocs(query(collection(db, 'properties'), orderBy('createdAt', 'desc')));
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
