import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import type { IntegrationProvider, IntegrationType } from '@/lib/types';

async function verifyAuth(authHeader: string | null): Promise<{ uid: string; role: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const db = getAdminDb();
  const uid = authHeader.slice(7);
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) return null;
  const role = userDoc.data()!.role as string;
  return { uid, role };
}

function canManageProperty(userRole: string, propertyOwnerId: string, userId: string): boolean {
  return ['super_admin', 'admin'].includes(userRole) || propertyOwnerId === userId;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const authUser = await verifyAuth(authHeader);
  if (!authUser) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getAdminDb();
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get('propertyId');

  let integrations;
  if (propertyId) {
    const snap = await db.collection('integrations').where('propertyId', '==', propertyId).get();
    integrations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } else if (['super_admin', 'admin'].includes(authUser.role)) {
    const snap = await db.collection('integrations').get();
    integrations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } else {
    // Get user's properties first, then their integrations
    const propsSnap = await db.collection('properties').where('ownerId', '==', authUser.uid).get();
    const propIds = propsSnap.docs.map(d => d.id);
    if (propIds.length === 0) return NextResponse.json([]);

    const allIntegrations: Record<string, unknown>[] = [];
    for (let i = 0; i < propIds.length; i += 10) {
      const batch = propIds.slice(i, i + 10);
      const snap = await db.collection('integrations').where('propertyId', 'in', batch).get();
      allIntegrations.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    integrations = allIntegrations;
  }

  return NextResponse.json(integrations);
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const authUser = await verifyAuth(authHeader);
  if (!authUser) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getAdminDb();
  const body = await req.json();
  const { propertyId, provider, type, config, syncIntervalMinutes } = body as {
    propertyId: string;
    provider: IntegrationProvider;
    type: IntegrationType;
    config: Record<string, string>;
    syncIntervalMinutes?: number;
  };

  if (!propertyId || !provider || !type) {
    return NextResponse.json({ error: 'propertyId, provider, type은 필수입니다.' }, { status: 400 });
  }

  // Verify property access
  const propDoc = await db.collection('properties').doc(propertyId).get();
  if (!propDoc.exists) {
    return NextResponse.json({ error: '숙소를 찾을 수 없습니다.' }, { status: 404 });
  }
  if (!canManageProperty(authUser.role, propDoc.data()!.ownerId, authUser.uid)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const integration = {
    propertyId,
    provider,
    type,
    config: config ?? {},
    status: 'active' as const,
    syncIntervalMinutes: syncIntervalMinutes ?? 15,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await db.collection('integrations').add(integration);

  return NextResponse.json({ id: docRef.id, ...integration }, { status: 201 });
}

export async function PUT(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const authUser = await verifyAuth(authHeader);
  if (!authUser) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getAdminDb();
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
  }

  const integDoc = await db.collection('integrations').doc(id).get();
  if (!integDoc.exists) {
    return NextResponse.json({ error: '연동을 찾을 수 없습니다.' }, { status: 404 });
  }

  const propDoc = await db.collection('properties').doc(integDoc.data()!.propertyId).get();
  if (!propDoc.exists || !canManageProperty(authUser.role, propDoc.data()!.ownerId, authUser.uid)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  // Only allow updating specific fields
  const allowedFields = ['config', 'status', 'syncIntervalMinutes', 'lastSyncAt', 'lastSyncStatus', 'lastErrorMessage', 'nextSyncAt'];
  const safeUpdates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of allowedFields) {
    if (key in updates) safeUpdates[key] = updates[key];
  }

  await db.collection('integrations').doc(id).update(safeUpdates);

  return NextResponse.json({ id, ...safeUpdates });
}

export async function DELETE(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const authUser = await verifyAuth(authHeader);
  if (!authUser) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const db = getAdminDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
  }

  const integDoc = await db.collection('integrations').doc(id).get();
  if (!integDoc.exists) {
    return NextResponse.json({ error: '연동을 찾을 수 없습니다.' }, { status: 404 });
  }

  const propDoc = await db.collection('properties').doc(integDoc.data()!.propertyId).get();
  if (!propDoc.exists || !canManageProperty(authUser.role, propDoc.data()!.ownerId, authUser.uid)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  await db.collection('integrations').doc(id).delete();

  return NextResponse.json({ success: true });
}
