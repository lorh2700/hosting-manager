import { PublicNavigation } from '@/components/PublicNavigation';
import { ChannelTalk } from '@/components/ChannelTalk';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 font-sans selection:bg-white/20">
      <PublicNavigation />
      {children}
      <ChannelTalk />
    </div>
  );
}
