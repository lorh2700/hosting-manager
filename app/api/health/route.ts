import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const checks: Record<string, unknown> = {
    now: new Date().toISOString(),
    env: {
      DB_HOST: !!process.env.DB_HOST,
      DB_USER: !!process.env.DB_USER,
      DB_PASSWORD: !!process.env.DB_PASSWORD,
      DB_NAME: !!process.env.DB_NAME,
      DB_PORT: !!process.env.DB_PORT,
      JWT_SECRET: !!process.env.JWT_SECRET,
      CRON_SECRET: !!process.env.CRON_SECRET,
      BEDS24_REFRESH_TOKEN: !!process.env.BEDS24_REFRESH_TOKEN,
      URL: process.env.URL ?? null,
    },
  };

  try {
    const started = Date.now();
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    checks.dbPingMs = Date.now() - started;
    checks.dbPingResult = rows;
  } catch (err) {
    checks.dbError = {
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
      name: err instanceof Error ? err.name : undefined,
    };
    return NextResponse.json(checks, { status: 500 });
  }

  try {
    const started = Date.now();
    const count = await prisma.property.count();
    checks.propertyCountMs = Date.now() - started;
    checks.propertyCount = count;
  } catch (err) {
    checks.propertyCountError = {
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
    };
    return NextResponse.json(checks, { status: 500 });
  }

  return NextResponse.json({ ...checks, ok: true });
}
