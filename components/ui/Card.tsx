export function Card({ children, className = '', padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <div className={`bg-white border border-stone-200 ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function CardHeader({ title, right, description, className = '' }: {
  title: React.ReactNode; right?: React.ReactNode; description?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <div className="flex-1 min-w-0">
        <h2 className="t-lead font-semibold text-stone-900">{title}</h2>
        {description && <p className="t-caption text-stone-500 mt-0.5">{description}</p>}
      </div>
      {right}
    </div>
  );
}

/** 카드 안의 구획. 위 구획과 선으로 나뉜다. */
export function CardSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`border-t border-stone-100 pt-4 mt-4 ${className}`}>{children}</div>;
}

/** 화면 상단 제목 블록 */
export function PageHeader({ eyebrow, title, description, right }: {
  eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <header className="border-b border-stone-200 pb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="t-label text-[var(--brand)] mb-1.5">{eyebrow}</p>}
        <h1 className="t-display text-stone-900">{title}</h1>
        {description && <p className="t-caption text-stone-500 mt-1.5">{description}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
