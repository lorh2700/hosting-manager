import { NextResponse } from 'next/server';
import { collection, addDoc, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { UserRole } from '@/lib/types';

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function verifyAdmin(authHeader: string | null): Promise<{ uid: string; role: string } | null> {
  // Extract uid from Authorization header (Firebase ID token would be used in production)
  // For now, we verify by checking the user document directly
  if (!authHeader?.startsWith('Bearer ')) return null;
  const uid = authHeader.slice(7);
  const userDoc = await getDoc(doc(db, 'users', uid));
  if (!userDoc.exists()) return null;
  const role = userDoc.data().role as string;
  if (!['super_admin', 'admin'].includes(role)) return null;
  return { uid, role };
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const admin = await verifyAdmin(authHeader);
  if (!admin) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const invitationsRef = collection(db, 'invitations');
  const snap = await getDocs(invitationsRef);
  const invitations = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  return NextResponse.json(invitations);
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const admin = await verifyAdmin(authHeader);
  if (!admin) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const body = await req.json();
  const { email, role, propertyIds } = body as {
    email: string;
    role: UserRole;
    propertyIds: string[];
  };

  if (!email || !role) {
    return NextResponse.json({ error: '이메일과 역할은 필수입니다.' }, { status: 400 });
  }

  if (!['admin', 'host', 'cleaner', 'viewer'].includes(role)) {
    return NextResponse.json({ error: '유효하지 않은 역할입니다.' }, { status: 400 });
  }

  // Check if invitation already exists for this email
  const existingQuery = query(
    collection(db, 'invitations'),
    where('email', '==', email),
    where('status', '==', 'pending')
  );
  const existing = await getDocs(existingQuery);
  if (!existing.empty) {
    return NextResponse.json({ error: '이미 대기중인 초대가 있습니다.' }, { status: 409 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = {
    email,
    role,
    propertyIds: propertyIds ?? [],
    invitedBy: admin.uid,
    status: 'pending' as const,
    token: generateToken(),
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  };

  const docRef = await addDoc(collection(db, 'invitations'), invitation);

  return NextResponse.json({
    id: docRef.id,
    ...invitation,
    inviteLink: `/invite/${invitation.token}`,
  }, { status: 201 });
}
