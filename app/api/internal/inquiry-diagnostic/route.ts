import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { diagnoseInquiry, inquiryDiagnosticSchema } from '@/lib/inquiry-diagnostic';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const expected = process.env.BACKEND_BRIDGE_SECRET;
  const provided = req.headers.get('x-backend-key') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!expected || expected.length < 32 || !provided || !timingSafeEqual(digest(expected), digest(provided))) return respond({ error: 'Unauthorized' }, 401);
  if (Number(req.headers.get('content-length') || 0) > 24_000) return respond({ error: 'Invalid request' }, 400);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > 24_000) return respond({ error: 'Invalid request' }, 400);
  let json: unknown;
  try { json = JSON.parse(text); } catch { return respond({ error: 'Invalid request' }, 400); }
  const parsed = inquiryDiagnosticSchema.safeParse(json);
  if (!parsed.success) return respond({ error: 'Invalid request' }, 400);
  const result = await diagnoseInquiry(parsed.data, async propertyId => {
    const [property, settings] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }),
      prisma.inquiryAutomationSettings.findUnique({ where: { propertyId }, select: { knowledge: true, enabled: true } }),
    ]);
    return property ? { name: property.name, knowledge: settings?.knowledge || '', enabled: settings?.enabled ?? false } : null;
  });
  return respond(result);
}
