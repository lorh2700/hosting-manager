import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const count = await prisma.message.count({
    where: { sender: 'guest', read: false },
  });
  return NextResponse.json({ count });
}
