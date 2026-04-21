import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ user: null, profile: null }, { status: 401 });
    }

    return NextResponse.json(session);
  } catch (err) {
    console.error('Auth me API error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    return NextResponse.json({ error: 'Internal error', message, code }, { status: 500 });
  }
}
