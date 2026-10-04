'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { readClientSession, type ClientAuthUser as AuthUser, type ClientUserProfile as UserProfile } from '@/lib/auth-session-client';

interface AuthContextType {
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  error: null,
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const fetchSession = useCallback(async () => {
    const run = ++latestRequest.current;
    const result = await readClientSession();
    if (run !== latestRequest.current) return;
    if (result.kind === 'authenticated') {
      setUser(current => current?.id === result.user.id && current.email === result.user.email ? current : result.user);
      setProfile(result.profile); setError(null);
    } else if (result.kind === 'signed-out') {
      setUser(null); setProfile(null); setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) void fetchSession(); });
    return () => { mounted = false; latestRequest.current += 1; };
  }, [fetchSession]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, error, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
