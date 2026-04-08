import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { getBeds24Token, BEDS24_BASE_URL, BEDS24_REFRESH_TOKEN } from '@/lib/beds24';

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
    const db = getAdminDb();
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

    // Convert Beds24 bookings to events
    const newEvents = allBookings
      .filter((b) => b.status !== 'cancelled' && b.arrival && b.departure)
      .map((b) => {
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

    // Upsert events to Firestore: use originalUid as document ID for idempotency
    const incomingUids = new Set(newEvents.map(e => e.originalUid));
    let eventsCreated = 0;
    let eventsUpdated = 0;

    for (const event of newEvents) {
      const docId = `beds24_${propertyId}_${event.originalUid}`;
      const docRef = db.collection('events').doc(docId);

      // Check existing
      const existing = await db.collection('events')
        .where('propertyId', '==', propertyId)
        .where('channelId', '==', 'beds24')
        .where('originalUid', '==', event.originalUid)
        .get();

      if (existing.empty) {
        await docRef.set(event);
        eventsCreated++;
      } else {
        // Update existing document
        const existingDoc = existing.docs[0];
        const existingData = existingDoc.data();
        if (existingData.start !== event.start || existingData.end !== event.end || existingData.title !== event.title) {
          await db.collection('events').doc(existingDoc.id).set(event);
          eventsUpdated++;
        }
      }
    }

    // Remove events that no longer exist in Beds24
    let eventsRemoved = 0;
    const existingEvents = await db.collection('events')
      .where('propertyId', '==', propertyId)
      .where('channelId', '==', 'beds24')
      .get();

    for (const existingDoc of existingEvents.docs) {
      const uid = existingDoc.data().originalUid;
      if (uid && !incomingUids.has(uid)) {
        await db.collection('events').doc(existingDoc.id).delete();
        eventsRemoved++;
      }
    }

    return NextResponse.json({
      success: true,
      total: newEvents.length,
      eventsCreated,
      eventsUpdated,
      eventsRemoved,
    });
  } catch (error) {
    console.error('Beds24 sync error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
