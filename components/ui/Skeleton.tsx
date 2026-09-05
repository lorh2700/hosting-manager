/**
 * 섹션 스켈레톤. 전체 화면 스피너 대신 화면 골격을 먼저 보여준다.
 *   <Skeleton className="h-4 w-32" />
 *   <SkeletonLines lines={3} />
 *   <SkeletonCard rows={2} />
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function SkeletonLines({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: `${[92, 70, 82, 60][i % 4]}%` }} />
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 2, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`bg-white border border-stone-200 p-5 space-y-4 ${className}`} aria-hidden>
      <div className="skeleton h-4 w-28" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-9 w-9 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-2/3" />
            <div className="skeleton h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 목록 화면 첫 로딩용: 카드 n 개 */
export function SkeletonList({ count = 3, rows = 2 }: { count?: number; rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} rows={rows} />)}
    </div>
  );
}
