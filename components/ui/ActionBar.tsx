'use client';

/**
 * 화면 아래 고정 액션 바. 하단 탭 바로 위, 안전 영역 위에 놓인다.
 * 주요 동작 하나(또는 둘)를 엄지 위치에 둔다. 본문에는 pb-nav 여백을 더 준다.
 */
export function ActionBar({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`fixed inset-x-0 z-40 bg-white/95 backdrop-blur-lg border-t border-stone-200 px-4 py-3 flex gap-2 ${className}`}
      style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom))' }}
    >
      <div className="max-w-2xl mx-auto w-full flex gap-2">{children}</div>
    </div>
  );
}
