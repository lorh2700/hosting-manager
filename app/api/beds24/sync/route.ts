import { NextResponse } from 'next/server';

const BEDS24_REFRESH_TOKEN = process.env.BEDS24_REFRESH_TOKEN;
const BEDS24_BASE_URL = 'https://beds24.com/api/v2';

async function getBeds24Token(): Promise<string> {
  if (!BEDS24_REFRESH_TOKEN) throw new Error('BEDS24_REFRESH_TOKEN is not configured');
  const res = await fetch(`${BEDS24_BASE_URL}/authentication/token`, {
    headers: { 'refreshToken': BEDS24_REFRESH_TOKEN },
  });
  if (!res.ok) throw new Error(`Beds24 token refresh failed: ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error('No token in Beds24 response');
  return data.token;
}

export async function POST(req: Request) {
  if (!BEDS24_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'BEDS24_REFRESH_TOKEN is not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { propertyId, beds24PropId } = body;

  if (!propertyId || !beds24PropId) {
    return NextResponse.json({ error: 'propertyId and beds24PropId are required' }, { status: 400 });
  }

  try {
    const token = await getBeds24Token();

    const today = new Date();
    const from = new Date(today);
    from.setMonth(from.getMonth() - 1);
    const to = new Date(today);
    to.setFullYear(to.getFullYear() + 1);

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    let allBookings: Record<string, unknown>[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      // NOTE: correct parameter is 'propertyId', not 'propId'
      const params = new URLSearchParams({
        propertyId: String(beds24PropId),
        departureFrom: fromStr,
        departureTo: toStr,
        page: String(page),
      });

      const response = await fetch(`${BEDS24_BASE_URL}/bookings?${params}`, {
        headers: { 'token': token },
      });

      if (!response.ok) {
        const errText = await response.text();
        return NextResponse.json(
          { error: `Beds24 API 오류: ${response.status} ${errText}` },
          { status: 502 }
        );
      }

      const data = await response.json();
      const bookings: Record<string, unknown>[] = data.data || [];
      allBookings = allBookings.concat(bookings);

      if (data.pages?.nextPageExists && bookings.length > 0) {
        page++;
      } else {
        hasMore = false;
      }
    }

    const events = allBookings
      .filter((b) => {
        // Beds24 API v2: status is a string ("new", "confirmed", "cancelled", etc.)
        return b.status !== 'cancelled' && b.arrival && b.departure;
      })
      .map((b) => {
        // Beds24 API v2: 'departure' is already the checkout date (not lastNight+1)
        const guestName = [b.firstName, b.lastName].filter(Boolean).join(' ') || '게스트';
        const channelSource = (b.channel as string) || (b.referer as string) || 'Beds24';

        const descriptionParts = [
          `게스트: ${guestName}`,
          b.email ? `이메일: ${b.email}` : '',
          b.phone ? `연락처: ${b.phone}` : '',
          `인원: 성인 ${b.numAdult || 0}명${b.numChild ? `, 아동 ${b.numChild}명` : ''}`,
          `채널: ${channelSource}`,
          b.price ? `금액: ₩${Number(b.price).toLocaleString()}` : '',
          b.notes ? `메모: ${b.notes}` : '',
        ].filter(Boolean).join('\n');

        return {
          propertyId,
          channelId: 'beds24',
          source: channelSource,
          title: guestName,
          start: b.arrival as string,
          end: b.departure as string,
          type: 'reservation' as const,
          originalUid: String(b.id),
          description: descriptionParts,
          createdAt: new Date().toISOString(),
        };
      });

    return NextResponse.json({ success: true, events, total: events.length });
  } catch (error) {
    console.error('Beds24 sync error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
