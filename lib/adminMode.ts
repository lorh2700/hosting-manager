'use client';

import { useSyncExternalStore } from 'react';

export type AdminMode = 'host' | 'tour';

const STORAGE_KEY = 'va_admin_mode';
const CHANGE_EVENT = 'va-admin-mode';

export function readAdminMode(): AdminMode {
  if (typeof window === 'undefined') return 'host';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'tour' ? 'tour' : 'host';
  } catch {
    return 'host';
  }
}

export function writeAdminMode(mode: AdminMode): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearAdminMode(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/**
 * 관리 영역(숙박/투어). 로그인 때 고르고 localStorage 에 둔다.
 * 서버 렌더에서는 'host' 로 두고, 클라이언트에서 저장값으로 맞춘다 (useSyncExternalStore 라 하이드레이션 안전).
 */
export function useAdminMode(): { mode: AdminMode } {
  const mode = useSyncExternalStore(subscribe, readAdminMode, () => 'host' as AdminMode);
  return { mode };
}
