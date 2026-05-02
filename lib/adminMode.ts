'use client';

import { useEffect, useState } from 'react';

export type AdminMode = 'host' | 'tour';

const STORAGE_KEY = 'va_admin_mode';

export function readAdminMode(): AdminMode {
  if (typeof window === 'undefined') return 'host';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'tour' ? 'tour' : 'host';
}

export function writeAdminMode(mode: AdminMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function clearAdminMode(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Read-only mode hook. The mode is chosen at login time and stored in
 * localStorage; consumers (sidebar, dashboard) reflect it but cannot
 * change it from inside the app — switching requires logging out.
 */
export function useAdminMode(): { mode: AdminMode } {
  const [mode, setMode] = useState<AdminMode>('host');

  useEffect(() => {
    setMode(readAdminMode());
  }, []);

  return { mode };
}
