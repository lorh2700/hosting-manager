import { Noto_Serif_KR } from 'next/font/google';
import { PublicNavigation } from '@/components/PublicNavigation';
import { ChannelTalk } from '@/components/ChannelTalk';
import { PublicLanguageProvider } from '@/components/PublicLanguage';

const brandSerif = Noto_Serif_KR({ weight: '400', adjustFontFallback: false, display: 'swap', preload: false, variable: '--font-brand-serif' });

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicLanguageProvider><div className={`${brandSerif.variable} min-h-screen bg-[#0C0A09] text-stone-50 font-sans selection:bg-white/20`}>
      <PublicNavigation />
      {children}
      <ChannelTalk />
    </div></PublicLanguageProvider>
  );
}
