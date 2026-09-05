'use client';

import { useEffect, useRef } from 'react';

/**
 * 화면에 돌아왔을 때(탭 복귀, 창 포커스, 네트워크 복구) 데이터를 다시 불러온다.
 * 모바일에서는 탭을 닫지 않고 몇 시간 뒤 다시 열기 때문에 오늘 화면·메시지는 이 훅으로 최신을 유지한다.
 * minIntervalMs 안에 두 번 호출되지 않도록 막는다.
 */
export function useRefetchOnReturn(refetch: () => unknown, opts: { minIntervalMs?: number; enabled?: boolean } = {}) {
  const { minIntervalMs = 15_000, enabled = true } = opts;
  // 0 = 아직 기준 시각 없음. 마운트 시점을 기준으로 잡아 첫 로딩 직후 중복 호출을 막는다.
  const last = useRef(0);
  const fnRef = useRef(refetch);
  useEffect(() => { fnRef.current = refetch; });

  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last.current < minIntervalMs) return;
      last.current = Date.now();
      fnRef.current();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    window.addEventListener('pageshow', run);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
      window.removeEventListener('pageshow', run);
    };
  }, [enabled, minIntervalMs]);
}
