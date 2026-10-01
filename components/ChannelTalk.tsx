'use client';

import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { usePublicLanguage } from '@/components/PublicLanguage';

// Public website plug-in key, not a Channel Talk Open API secret.
const PLUGIN_KEY = '3294b495-fbd1-457d-9c20-6a0dfcb16f86';

export function ChannelTalk() {
  const { language } = usePublicLanguage();
  const pathname = usePathname();
  const bookingPage = !!pathname?.startsWith('/book/') && !pathname.startsWith('/book/checkout/');
  const [ready, setReady] = useState(false);
  // Payment return URLs carry provider parameters and guest order credentials.
  const enabled = !!pathname && !pathname.startsWith('/book/checkout/');

  useEffect(() => {
    setReady(false);
    if (!enabled) return;
    let cancelled = false;
    let shutdown: (() => void) | undefined;
    void import('@channel.io/channel-web-sdk-loader').then(channel => {
      if (cancelled) return;
      channel.loadScript();
      channel.boot({ pluginKey: PLUGIN_KEY, language,
        ...(bookingPage ? { hideChannelButtonOnBoot: true, hidePopup: true } : {}),
      }, error => { if (!cancelled && !error) setReady(true); });
      shutdown = () => channel.shutdown();
    }).catch(() => {
      // A blocked third-party widget must not interrupt booking.
    });
    return () => { cancelled = true; shutdown?.(); };
  }, [enabled, language, bookingPage]);

  return bookingPage && ready ? <button type="button" onClick={() => { void import('@channel.io/channel-web-sdk-loader').then(channel => channel.showMessenger()); }} aria-label={language === 'en' ? 'Chat with us' : '숙소 문의하기'} className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-900 shadow-lg lg:bottom-6"><MessageCircle size={22} /></button> : null;
}
