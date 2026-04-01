import { NextResponse } from 'next/server';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SEED_PROPERTIES } from '@/lib/seedData';

export async function POST(req: Request) {
  const body = await req.json();
  const { ownerId } = body;

  if (!ownerId) {
    return NextResponse.json({ error: 'ownerId is required' }, { status: 400 });
  }

  try {
    for (const prop of SEED_PROPERTIES) {
      const propRef = await addDoc(collection(db, 'properties'), {
        name: prop.name,
        timezone: prop.timezone,
        beds24PropId: (prop as { beds24PropId?: string }).beds24PropId ?? null,
        checkInTime: (prop as { checkInTime?: string }).checkInTime ?? null,
        checkOutTime: (prop as { checkOutTime?: string }).checkOutTime ?? null,
        address: (prop as { address?: string }).address ?? null,
        phone: (prop as { phone?: string }).phone ?? null,
        email: (prop as { email?: string }).email ?? null,
        permit: (prop as { permit?: string }).permit ?? null,
        ownerId,
        createdAt: new Date().toISOString(),
      });

      for (const ch of prop.channels) {
        const exportToken = crypto.randomUUID();
        await addDoc(collection(db, 'channels'), {
          propertyId: propRef.id,
          name: ch.name,
          importUrl: ch.importUrl,
          exportUrl: `/api/export/${exportToken}.ics`,
          isActive: ch.isActive,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
