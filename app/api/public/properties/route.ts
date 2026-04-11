import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, timezone: true, description: true },
    });
    // Add placeholder fields not in DB for UI compat
    const result = properties.map(p => ({
      ...p,
      imageUrl: null,
      images: [],
      region: null,
      description: p.description ?? null,
    }));
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch properties:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
