import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { deliverCleaningAssignmentNotifications } from '@/lib/cleaning-assignment-notifications';
import { HttpError } from '@/lib/core/errors';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  const expected = process.env.BACKEND_BRIDGE_SECRET;
  const provided = req.headers.get('x-backend-key') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!expected || expected.length < 32 || !provided || !timingSafeEqual(digest(expected), digest(provided))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    if (Number(req.headers.get('content-length') || 0) > 1024) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const text = await req.text();
    if (text.length > 1024) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
      || !('auditId' in body) || typeof body.auditId !== 'string' || !body.auditId || body.auditId.length > 150) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    return NextResponse.json(await deliverCleaningAssignmentNotifications(body.auditId));
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[cleaning-assignment-notifications] delivery state unavailable');
    return NextResponse.json({ status: 'unknown' }, { status: 503 });
  }
}
