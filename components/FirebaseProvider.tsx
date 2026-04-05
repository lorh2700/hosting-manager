'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { UserRole, UserStatus } from '@/lib/types';

interface UserProfile {
  role: UserRole;
  propertyIds: string[];
  displayName: string;
  phone?: string;
  status: UserStatus;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Check if this user has a pending invitation and apply it */
async function applyPendingInvitation(user: User): Promise<{
  role: UserRole;
  propertyIds: string[];
} | null> {
  if (!user.email) return null;

  const invitationsRef = collection(db, 'invitations');
  const q = query(
    invitationsRef,
    where('email', '==', user.email),
    where('status', '==', 'pending')
  );
  const snap = await getDocs(q);

  if (snap.empty) return null;

  // Use the most recent pending invitation
  const invDoc = snap.docs[0];
  const inv = invDoc.data();

  // Check expiry
  if (new Date(inv.expiresAt) < new Date()) {
    await updateDoc(doc(db, 'invitations', invDoc.id), { status: 'expired' });
    return null;
  }

  // Mark invitation as accepted
  await updateDoc(doc(db, 'invitations', invDoc.id), { status: 'accepted' });

  return {
    role: inv.role as UserRole,
    propertyIds: (inv.propertyIds as string[]) ?? [],
  };
}

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (u: User): Promise<UserProfile> => {
    const ref = doc(db, 'users', u.uid);
    const snap = await getDoc(ref);
    const now = new Date().toISOString();

    if (snap.exists()) {
      const data = snap.data();

      // Check account status
      const status = (data.status as UserStatus) ?? 'active';
      if (status === 'suspended') {
        return {
          role: data.role as UserRole,
          propertyIds: [],
          displayName: data.displayName ?? u.displayName ?? u.email ?? '',
          status: 'suspended',
        };
      }

      // Normalize legacy 'admin' role to 'super_admin'
      const rawRole = data.role as string;
      const role: UserRole = rawRole === 'admin' ? 'super_admin' : ((rawRole as UserRole) ?? 'host');

      // Update lastLoginAt
      await updateDoc(ref, { lastLoginAt: now }).catch(() => {});

      return {
        role,
        propertyIds: (data.propertyIds as string[]) ?? [],
        displayName: data.displayName ?? u.displayName ?? u.email ?? '',
        phone: data.phone,
        status: (data.status as UserStatus) ?? 'active',
      };
    }

    // New user — check for pending invitation
    const invitation = await applyPendingInvitation(u);

    const newRole: UserRole = invitation?.role ?? 'host';
    const newPropertyIds: string[] = invitation?.propertyIds ?? [];
    const newStatus: UserStatus = invitation ? 'active' : 'pending_invite';

    const newProfile: UserProfile = {
      role: newRole,
      propertyIds: newPropertyIds,
      displayName: u.displayName ?? u.email ?? '',
      status: newStatus,
    };

    await setDoc(ref, {
      email: u.email,
      role: newProfile.role,
      propertyIds: newProfile.propertyIds,
      displayName: newProfile.displayName,
      status: newProfile.status,
      invitedBy: invitation ? 'invitation' : undefined,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return newProfile;
  };

  const refreshProfile = async () => {
    if (!user) return;
    const p = await loadProfile(user);
    setProfile(p);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Skip profile loading for anonymous users (used for public calendar access)
        if (u.isAnonymous) {
          setProfile(null);
          setLoading(false);
          return;
        }
        try {
          const p = await loadProfile(u);
          setProfile(p);
        } catch (e) {
          console.error('Failed to load user profile', e);
          setProfile({ role: 'host', propertyIds: [], displayName: u.email ?? '', status: 'pending_invite' });
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
