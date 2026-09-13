'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { translatePublic } from '@/lib/public-copy';

type Language = 'ko' | 'en';
let sessionLanguage: Language | null = null;
function snapshot(): Language {
  if (sessionLanguage) return sessionLanguage;
  try {
    const stored = localStorage.getItem('void-public-language');
    if (stored === 'en' || stored === 'ko') return stored;
  } catch { /* Private browsing may block storage. */ }
  return navigator.language.startsWith('ko') ? 'ko' : 'en';
}
function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === 'void-public-language' || event.key === null) { sessionLanguage = null; onChange(); } };
  window.addEventListener('void-public-language', onChange);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener('void-public-language', onChange); window.removeEventListener('storage', onStorage); };
}
const serverSnapshot = (): Language => 'ko';
const Context = createContext({ language: 'ko' as Language, setLanguage: (_: Language) => {}, t: (text: string) => text });
export function PublicLanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setLanguage = useCallback((value: Language) => {
    sessionLanguage = value;
    try { localStorage.setItem('void-public-language', value); } catch { /* Switching still works without storage. */ }
    window.dispatchEvent(new Event('void-public-language'));
  }, []);
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = previous; };
  }, [language]);
  const t = useCallback((text: string) => translatePublic(text, language), [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const usePublicLanguage = () => useContext(Context);
export function PublicLanguageSwitch() {
  const { language, setLanguage } = usePublicLanguage();
  return <button type="button" onClick={() => setLanguage(language === 'ko' ? 'en' : 'ko')}
    lang={language === 'ko' ? 'en' : 'ko'} aria-label={language === 'ko' ? 'Switch to English' : '한국어로 변경'}
    className="min-h-11 min-w-11 px-2 text-xs text-stone-200 hover:text-white focus-visible:outline focus-visible:outline-2">
    {language === 'ko' ? 'EN' : '한국어'}
  </button>;
}
