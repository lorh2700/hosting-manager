'use client';

/**
 * 당겨서 새로고침. 스크롤 맨 위에서 아래로 70px 이상 끌면 onRefresh 를 호출한다.
 * WebView 앱에는 새로고침 버튼이 없으므로 오늘·메시지 같은 화면에 감싼다.
 */
import { useRef, useState } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

const THRESHOLD = 70;

export function PullToRefresh({ onRefresh, children, className = '' }: {
  onRefresh: () => Promise<unknown> | unknown; children: React.ReactNode; className?: string;
}) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing || !atTop()) { startY.current = null; return; }
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0 || !atTop()) { setPull(0); return; }
    // 저항감: 끌수록 덜 움직인다
    setPull(Math.min(120, dy * 0.55));
  };
  const onTouchEnd = async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (pull >= THRESHOLD * 0.55) {
      setRefreshing(true);
      setPull(0);
      try { await onRefresh(); } finally { setRefreshing(false); }
    } else {
      setPull(0);
    }
  };

  const armed = pull >= THRESHOLD * 0.55;
  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className={className}>
      <div
        aria-hidden
        className="flex items-center justify-center overflow-hidden text-stone-500 transition-[height] duration-150"
        style={{ height: refreshing ? 40 : pull }}
      >
        {refreshing
          ? <Loader2 size={18} className="animate-spin text-[var(--brand)]" />
          : pull > 8 && <ArrowDown size={18} className={`transition-transform ${armed ? 'rotate-180 text-[var(--brand)]' : ''}`} />}
      </div>
      {children}
    </div>
  );
}
