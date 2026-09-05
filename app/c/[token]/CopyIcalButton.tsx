'use client';

import { useState } from 'react';
import { Check, Copy, CalendarPlus } from 'lucide-react';

export default function CopyIcalButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const url = `${window.location.origin}/c/${token}/ical.ics`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('복사에 실패했습니다.');
    }
  };

  const webcalUrl = typeof window !== 'undefined'
    ? `webcal://${window.location.host}/c/${token}/ical.ics`
    : `/c/${token}/ical.ics`;

  return (
    <div className="flex items-center gap-2">
      <a
        href={webcalUrl}
        className="flex items-center gap-2 text-[13px] uppercase tracking-widest text-white hover:bg-white hover:text-black border border-white/30 px-3 py-2 transition-colors"
      >
        <CalendarPlus size={13} />
        캘린더 앱에 구독
      </a>
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 text-[13px] uppercase tracking-widest text-white/60 hover:text-white border border-white/10 hover:border-white/30 px-3 py-2 transition-colors"
        title="iCal URL 복사"
      >
        {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
        {copied ? '복사됨' : 'URL 복사'}
      </button>
    </div>
  );
}
