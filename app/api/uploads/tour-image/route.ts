import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { uploadToSupabaseStorage } from '@/lib/supabaseStorage';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const session = await verifySession(req);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'JPEG/PNG/WEBP/GIF 만 업로드 가능합니다.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: '파일 크기는 8MB 이하여야 합니다.' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await uploadToSupabaseStorage({
      buffer,
      contentType: file.type,
      filename: file.name || `image.${file.type.split('/')[1] ?? 'bin'}`,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ url: result.url, path: result.path }, { status: 201 });
  } catch (e) {
    console.error('[uploads/tour-image] POST error:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
