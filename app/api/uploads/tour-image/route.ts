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

    // Read the file as a raw body to sidestep Next 15 + Turbopack's flaky
    // multipart parsing ("expected boundary after body" errors). The client
    // sends file bytes directly with x-filename and the original
    // Content-Type header.
    const contentType = req.headers.get('content-type') || 'application/octet-stream';
    if (!ALLOWED.includes(contentType)) {
      return NextResponse.json(
        { error: `JPEG/PNG/WEBP/GIF 만 업로드 가능합니다. (받은 형식: ${contentType})` },
        { status: 400 },
      );
    }

    const filenameHeader = req.headers.get('x-filename');
    const filename = filenameHeader
      ? decodeURIComponent(filenameHeader)
      : `image.${contentType.split('/')[1] ?? 'bin'}`;

    let buffer: ArrayBuffer;
    try {
      buffer = await req.arrayBuffer();
    } catch (err) {
      console.error('[uploads/tour-image] body read error:', err);
      return NextResponse.json(
        {
          error: '업로드 본문을 읽지 못했습니다. 파일 선택 후 다시 시도해주세요.',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 400 },
      );
    }

    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: '빈 파일입니다.' }, { status: 400 });
    }
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `파일 크기는 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 이하여야 합니다.` },
        { status: 400 },
      );
    }

    const result = await uploadToSupabaseStorage({
      buffer,
      contentType,
      filename,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ url: result.url, path: result.path }, { status: 201 });
  } catch (e) {
    console.error('[uploads/tour-image] POST error:', e);
    return NextResponse.json(
      {
        error: '서버 오류가 발생했습니다.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
