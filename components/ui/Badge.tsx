export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-700',
  brand: 'bg-[var(--brand-tint)] text-[var(--brand-dark)]',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-600',
  info: 'bg-sky-50 text-sky-700',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 t-micro font-semibold tracking-wide ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}
