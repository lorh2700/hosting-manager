'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { usePublicLanguage } from '@/components/PublicLanguage';

// Public website plug-in key, not a Channel Talk Open API secret.
const PLUGIN_KEY = '3294b495-fbd1-457d-9c20-6a0dfcb16f86';

export function ChannelTalk() {
  const { language } = usePublicLanguage();
  const pathname = usePathname();
  // Payment return URLs carry provider parameters and guest order credentials.
  const enabled = !!pathname && !pathname.startsWith('/book/checkout/');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let shutdown: (() => void) | undefined;
    void import('@channel.io/channel-web-sdk-loader').then(channel => {
      if (cancelled) return;
      channel.loadScript();
      channel.boot({ pluginKey: PLUGIN_KEY, language });
      shutdown = () => channel.shutdown();
    }).catch(() => {
      // A blocked third-party widget must not interrupt booking.
    });
    return () => { cancelled = true; shutdown?.(); };
  }, [enabled, language]);

  return null;
}
