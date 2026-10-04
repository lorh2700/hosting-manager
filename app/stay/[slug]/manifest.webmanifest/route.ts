import { getPropertyDisplay } from '@/lib/property-display';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const property = getPropertyDisplay(slug);
  if (slug !== 'preview' && (!property || property.status !== 'active')) return new Response('Not found', { status: 404 });
  return Response.json({
    id: '/stay/' + slug, name: 'void anchae · Guest Lounge', short_name: 'Guest Lounge',
    start_url: '/stay/' + slug, scope: '/stay/', display: 'standalone', orientation: 'portrait',
    background_color: '#f7f7ee', theme_color: '#263d35',
    icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
